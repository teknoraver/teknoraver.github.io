+++
title = "Low Quality of Service: How My Router Broke Git"
date = "2026-04-16T01:21:14+02:00"

description = "How a router bug silently broke Git and scp."

tags = ["ssh", "networking", "linux", "ip", "debugging", "qos"]
+++

QoS stands for Quality of Service. Improvement is not implied.

> **TL;DR**: SSH hangs on non-interactive commands (`git pull`, `scp`, `ssh host cmd`) while interactive shells work? Your router is probably including the DSCP byte in its flow-hashing table. OpenSSH changes DSCP mid-connection for non-interactive sessions, and buggy routers lose the flow. Fix: add `IPQoS af21` to your SSH config.

## Symptoms

I've been a happy OpenWrt user for 20 years,
but due to a hardware failure I had to temporarily switch back to my ISP router.  
After the swap, every `git pull` started hanging.
No errors, just a timeout after a few minutes.  

## The investigation

The usual suspects were checked first:
- **DNS** — always the first suspect, but manual resolution with `dig` worked fine.
- **MTU/MSS clamping** — second suspect, but usually also breaks HTTP downloads.
- **IPv6** — I disabled IPv6 just in case, but the problem persisted.
- **Firewall rules** — I could connect with netcat to github.com:22 and see the SSH banner.

I didn't find any issues with general connectivity,
so I focused on Git and noticed that some repositories were working while others weren't.
Initially I thought that it could be a server-side issue,
but the failing repositories were spread between GitHub and GitLab,
so it was unlikely that both services had simultaneous issues.

On closer inspection, I noticed a pattern: all the failing repositories were ones I contributed to,
and they were using SSH URLs.
The same repositories worked fine over HTTPS.

I tried to connect to GitHub with ssh and I got the usual message about no shell access:
```text
$ ssh git@github.com
PTY allocation request failed on channel 0
Hi teknoraver! You've successfully authenticated, but GitHub does not provide shell access.
Connection to github.com closed.
```

So the GitHub server was reachable and the SSH connection working.
I tried connecting to other servers via SSH; getting a shell worked fine, so this wasn't a general SSH issue.  
But as soon as I tried to run a remote command or transfer a file with `scp`, I got the same hanging behavior.

To recap:
- `ssh user@host`: can log in and get a shell.
- `ssh user@host 'ls /tmp'`: handshake completes, then hangs.
- `scp file user@host:/tmp`: handshake completes, then hangs.

## Packet capture analysis

With no obvious explanation for why SSH login worked but remote command execution didn't,
I captured the traffic with `Wireshark` from both an interactive SSH session and a non-interactive one.
At first sight the packet captures looked the same: the TCP handshake completed,
key exchange succeeded, and the SSH session was established in both cases.
The only difference was that the non-interactive session stopped working,
while the interactive one continued to work normally.
I focused on the differences between the two sessions, and that's when I noticed something interesting:
in the non-interactive session the packets from client to server changed
the DSCP value in the IP header, while in the interactive session the
[DSCP](https://en.wikipedia.org/wiki/Differentiated_services) value remained constant.

I started ssh with verbose logging to see if this was an intended behavior of OpenSSH, and indeed it was:
OpenSSH sets different QoS markings for interactive vs non-interactive sessions.
The relevant lines from the `-vvv` output were:

```text
$ ssh -vvv user@host |& grep IP_TOS
debug3: set_sock_tos: set socket 3 IP_TOS 0x48
debug3: set_sock_tos: set socket 3 IP_TOS 0x48

$ ssh -vvv user@host id |& grep IP_TOS
debug3: set_sock_tos: set socket 3 IP_TOS 0x48
debug3: set_sock_tos: set socket 3 IP_TOS 0x20
```

Decoding the values (DSCP is the upper 6 bits of the [ToS](https://en.wikipedia.org/wiki/Type_of_service) byte):
- `0x48`: TOS byte = 72; DSCP = `72 >> 2 = 18`, **AF21**
- `0x20`: TOS byte = 32; DSCP = `32 >> 2 = 8`, **CS1**

OpenSSH sets the TOS byte to 0x48 (AF21) for interactive sessions, and 0x20 (CS1) for non-interactive sessions.
Fair enough, interactive sessions are latency-sensitive, while non-interactive sessions are throughput-oriented.
But could it be the root cause of the problem? I had no reason to suspect it at first, but I wanted to check,
so I forced OpenSSH to use a specific QoS marking for all sessions by adding `-o IPQoS=af21` to the command line.
Surprisingly, the non-interactive session worked perfectly with a consistent TOS value of 0x48.

```text
# Default, no IPQoS override
$ ssh -vvv user@host uptime 2>&1 | grep IP_TOS
debug3: set_sock_tos: set socket 3 IP_TOS 0x48
debug3: set_sock_tos: set socket 3 IP_TOS 0x20   # hang

# With IPQoS=af21
$ ssh -vvv -o IPQoS=af21 user@host uptime 2>&1 | grep IP_TOS
debug3: set_sock_tos: set socket 3 IP_TOS 0x48
debug3: set_sock_tos: set socket 3 IP_TOS 0x48   # works

# With IPQoS=cs1
$ ssh -vvv -o IPQoS=cs1 user@host uptime 2>&1 | grep IP_TOS
debug3: set_sock_tos: set socket 3 IP_TOS 0x20
debug3: set_sock_tos: set socket 3 IP_TOS 0x20   # works
```

Two `setsockopt(IP_TOS)` calls are made by OpenSSH: the first during socket setup,
the second after the SSH channel type has been negotiated.
With no override, the TOS byte changes between those two calls for non-interactive sessions,
which is exactly when the session dies.

## Root cause (my guess): broken flow hashing in the router

The new router, an ISP-supplied **Vodafone Station HHG2500**, was performing some form of traffic acceleration,
likely offloading established TCP flows to hardware fast-path (common in ISP-provided and consumer gear).
The flow classifier was hashing the 5-tuple *plus* the DSCP/ToS byte to identify flows.

When the DSCP value changed mid-connection (perfectly legal,
DSCP is a per-hop hint, and nothing prevents it from changing mid-connection),
the router's flow table lookup failed to match the existing entry.
The router's fast-path dropped the packets (or failed to forward them),
while the slow-path either never picked them up or silently discarded them.
The result: a one-way blackhole after the SSH channel negotiation.

DSCP is not a flow identifier.
OpenSSH's behavior — setting different DSCP markings for interactive vs non-interactive sessions — is perfectly correct:
DSCP is a per-packet QoS hint, not part of the connection's identity, and endpoints are free to change it mid-flow.
The canonical [5-tuple](https://www.rfc-editor.org/rfc/rfc6438.html#section-1.1)
for flow tracking is `{src IP, dst IP, src port, dst port, protocol}`.
Including the ToS/DSCP byte in the hash breaks the assumption that a connection remains the same connection if ToS changes,
which it legitimately can.

A correct hardware offload implementation would either exclude DSCP from the flow hash entirely,
or re-classify the flow on DSCP change rather than dropping it.

## The fix

The simplest workaround is to override OpenSSH's default QoS behavior and force a single,
consistent DSCP marking for all session types.
I added the following to `/etc/ssh/ssh_config.d/99-dscp.conf`:

```text
IPQoS af21
```

`af21` (DSCP decimal 18) corresponds to Assured Forwarding class 2, low drop precedence.
It's the value OpenSSH already uses for interactive sessions,
so this effectively forces non-interactive sessions to use the same marking,
preventing any mid-connection DSCP transition.
Not the ideal solution, but it's better than forcing all sessions to use `cs1` (DSCP decimal 8),
which is a lower-priority class and might lead to worse performance for interactive sessions.

## Conclusion

The previous router (OpenWrt-based) used a straightforward kernel nftables firewall,
and [nf flowtable](https://www.kernel.org/doc/Documentation/networking/nf_flowtable.txt)
as a traffic accelerator, which tracks flows on the standard 5-tuple.
It doesn't consider the DSCP bits when classifying flows, so the
DSCP changes are invisible to it, as they should be.

Twenty years on OpenWrt-based hardware, zero issues of this class.
That says a lot about the gap between open-source networking and whatever ships in commodity router firmware.
