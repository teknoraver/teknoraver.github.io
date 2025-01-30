+++
title = "Why you should run a 64 bit OS on your Raspberry Pi4"
date = "2020-01-18T12:00:00+01:00"
description = "Evaluating Raspberry Pi4 performances on both 32 and 64 bit"

tags = ["linux","arm","raspberry","benchmark"]
+++

One of the cool things of working for a software company is that very often you get new hardware prototypes to test.  
But this is not the case, I bought the Rpi4 because it's extremely cheap!

The Rpi4 comes with a quad core ARM Cortex A72, up to 4 GB of RAM and a gigabit Ethernet port, at a very low price of $35.  
Raspberry provides [Raspbian](https://www.raspberrypi.com/software/) (a Debian derivative),
an already ready distro for their products, so I put it on an SD card to boot it quickly.  
I was looking at the syslog and I noticed that, uh, both the kernel and the whole userland are compiled as armv7, which means 32 bit ARM.

I know for sure that the RPi4 is 64 bit capable, so I refused to run a 32 bit OS on it.
I got another SD card and I installed Debian on it. A lean and mean Debian compiled as [aarch64](https://en.wikipedia.org/wiki/ARM_architecture_family#AArch64), which means 64 bit ARM.  
As soon as the 64 bit OS booted, I was curious to know how much it performs better than the 32 bit one, so I did some tests.

EDIT: by popular demand, I'm publishing the Debian image.

The two partitions (boot and root) are compressed in a .tar.xz file, and there is a convenient script `mksd` which partitions an SD card and extracts the above.

I've kept it simple, so it's a very minimal distribution, you have to install your preferred tools by hand.  
The kernel is not the vanilla I used in the tests, but the stable 4.19 by Raspberry, because it supports a whole range of devices that my build doesn't.

The system is configured to get an IP via DHCP on the Ethernet interface. Login via SSH with credential user/user and then gain root with `sudo -i`.

I put it on Google Drive:
[rpi4_64bit.zip](https://drive.google.com/file/d/1-tAZESev2uzI3c09kCpYcv1e6_SRJYKT/view)

Feedback is welcome.

EDIT2:

Raspberry just [started selling the Raspberry Pi4 with 8 GB RAM](https://www.raspberrypi.com/news/8gb-raspberry-pi-4-on-sale-now-at-75/).
As you can imagine, this is another good reason to use a 64 bit kernel, otherwise the usable memory will be limited to a mere 3 GB.

## Synthetic benchmarks
The first test which came to my mind was the old dhrystone bench which exists since the dawn of time.

{{< figure src="dhrystones.png" caption="dhrystones per second, higher is better" >}}

dhrystone is a program written in 1988 which does some math calculations.  
It's unlikely to simulate any modern workload, the only way we still use it is to have some consistency between past architectures and software.  
A modern number crunching application could be some hash calculation, so I wanted to do a *SHA1* test.  
Unfortunately the Debian *sha1sum* utility was compiled without libssl or kernel crypto support, so I had to compile it from source.  
To avoid an I/O bottleneck, I calculated the hash of a 2 GB sparse file created with `truncate -s 2GB`, so the I/O from the sd card was zero:

A SHA1 hash is a more real-life benchmark than dhrystone as this algorithm is used in really a lot of applications, e.g. torrent, git, etc.

{{< figure src="sha1sum.png" caption="sha1sum execution time in seconds, lower is better" >}}

## RAM
A 64 bit system means that RAM can be accessed in 8 byte read/writes per instruction.
I wrote a [membench](https://gist.github.com/teknoraver/ec3bb8b5616e0599684689d6f874546f), a simple tool which allocates a big buffer, writes it and then reads it back.  
To be sure that the [RAM was really allocated](https://en.wikipedia.org/wiki/Memory_overcommitment) I used `mlock()` on the whole buffer.
In this test the buffer is 2 GB; a 3 GB buffer worked in 64 bit mode but gave an out-of-memory error in 32 bit.

{{< figure src="ram.png" caption="ram access in mbytes per second, higher is better" >}}

## Audio encoding
I noticed that many Rpi users use the board as mediacenter, so I did an audio encoding with the two most used codecs.  
I encoded "Echoes" by Pink Floyd because it's a very long track to obtain some measurable values.
To avoid I/O, both the source and the destination file were on a ramfs:

{{< figure src="lame.png" caption="lame encoding time in seconds, lower is better" >}}

{{< figure src="flac.png" caption="flac encoding time in seconds, lower is better" >}}

## Networking benchmarks
Another usage of the Raspberry boards is to act as a simple VPN or firewall.  
I don't endorse the usage of such systems for this purpose, but many people still have slow <100 mbit links, so they can turn a blind eye to the bad Rpi performance.  
The first question is: how much traffic can the Rpi4 handle?  
We need to measure the pure networking power of the board, without the limitations of the physical interface first, so I ran an iperf3 session between two containers.  
Beware, containers tend to communicate via a veth pair, and veth is known to accelerate the traffic via a lot of fake offloads.  
IP checksum offload is done by just skipping the checksum calculation, while TCP segmentation offload is done by never segmenting or reassembling the traffic: big chunks of 64k data are just passed in memory as is.  
To overcome it, I disabled the offloadings with `ethtool -K veth0 tx off rx off tso off gro off gso off`

{{< figure src="iperf.png" caption="mbit per second, higher is better" >}}

## Firewalling
The fastest thing that a network appliance can do is to drop traffic,
and the fastest way to drop traffic is via a TC drop rule.  
To avoid reaching the line rate, I used the minimum Ethernet frame size, 64 bytes.  
This is a drop rate test.

{{< figure src="firewall.png" caption="thousands of packets per second, higher is better" >}}

Although both systems were unable to reach the line rate (which is 1.5 Mpps), the 64 bit kernel scored a bit more than the 32 bit one.  
If you want to use the Rpi4 as firewall, a 64 bit kernel is definitely a must have.

## VPN
Another common usage of the Rpi is as VPN server, [OpenVPN](https://openvpn.net/) to be precise.  
My preferred VPN software is [WireGuard](https://www.wireguard.com/), so I tested both, as both are very simple to set up:

{{< figure src="vpn.png" caption="mbit per second, higher is better" >}}

As expected, OpenVPN is 10x slower than WireGuard. A less expected result is that OpenVPN performs the same in both 32 and 64 bit mode.  
WireGuard instead, almost saturates the gigabit port in both versions, indeed we have the same results with both kernels, probably we hit the NIC limit.  
To check if WireGuard could go even faster, I did another VPN test using two containers, so I skipped the physical Ethernet.  
The only drawback with this container test is that both the iperf3 client and server were running on the Rpi4, keeping two cores busy.

{{< figure src="container_vpn.png" caption="mbit per second, higher is better" >}}

As expected, OpenVPN and 32 bit WireGuard, which were CPU limited, performed worse, while 64 bit WireGuard performed better.

## Conclusions
Often I read statements like "It's not worth it", "you will gain a few milliseconds", etc. just because the Rpi is not that powerful.  
That's not true! As any embedded guy may know, with slow hardware, having a very optimized software is even more important than with powerful ones.  
I already knew that a 64 bit OS would perform better on the Rpi4, what I didn't know was how much.  
This is why I did this test series, I hope that you enjoy reading it!
