+++
title = "Linux and FreeBSD networking"
date = "2018-11-12T12:00:00+01:00"
description = "Linux and FreeBSD networking. Brief comparison of the two networking stacks"
tags = ["linux","freebsd","networking","benchmark"]
+++

## Incipit
I work on the networking subsystem of the Linux kernel and I find networks rather fascinating.
Often I read statements about the FreeBSD networking stack being faster and more mature than the Linux counterpart,
but I didn't find any comparative tests between the two OSes, and I was so curious that I decided to do some tests myself.

## Test setup
To avoid having to setup cables and interfaces on bare metal systems, I decided to get a single,
powerful server, and partition it into four VMs, two running *Fedora 29*, and two running *FreeBSD 11.2-RELEASE*.

The hardware is a [Dell PowerEdge R730](https://i.dell.com/sites/doccontent/shared-content/data-sheets/en/Documents/Dell-PowerEdge-R730-Spec-Sheet.pdf):
* two [E5–2690 v4 @ 2.60 GHz](https://www.intel.com/content/www/us/en/products/sku/91770/intel-xeon-processor-e52690-v4-35m-cache-2-60-ghz/specifications.html) with a total of 28 physical cores (56 with HT)
* 128 GB (8 x 16 GB) DDR4 2400 RAM
* [Samsung SM863a](https://semiconductor.samsung.com/ssd/enterprise-ssd/sm863a/) 240 GB SSD
* 2 x [Intel 82599ES](https://www.intel.com/content/www/us/en/products/sku/41282/intel-82599es-10-gigabit-ethernet-controller/specifications.html) 10 Gbit Ethernet card

The hypervisor is *KVM* on Fedora 29 with latest 4.19 kernel.

The server was partitioned so that any task of the host OS couldn't interfere with the guests' VCPU:
8 physical CPUs (12,14,16,18,20,22,24,26) were removed from the scheduler with RCU callback and timer off,
and system was booted with `nosmt=force` to avoid using their HT siblings.

Both the 10 Gbit cards were on the first NUMA node, so I decided to completely disable the second NUMA node
by putting all the CPUs and memory of the second node off with the `mem=64G` kernel command line and a script run at boot:

```bash
for i in /sys/devices/system/cpu/cpu* /sys/bus/memory/devices/memory*; do
	! [ -e "$i/node0" ] && [ -f "$i/online" ] && echo -n "${1-0}" >"$i/online"
done
```

Intel Turbo Boost and P-states are known to skew benchmarks, so they were disabled by the kernel
command line and writing with `wrmsr-pX 0x1a0 0x4000850089` in the appropriate register on each CPU.

[Spectre and Meltdown](https://meltdownattack.com/) mitigations were disabled via kernel command line.
At the end, the kernel command line was:

```
mem=64G pti=off intel_pstate=disable l1tf=off nosmt=force spectre_v2=off spec_store_bypass_disable=off isolcpus=12,14,16,18,20,22,24,26 nohz_full=12,14,16,18,20,22,24,26 rcu_nocbs=12,14,16,18,20,22,24,26
```

Guests were interconnected via a [DPDK](https://www.dpdk.org/) switch, which can handle millions
of packets per second with a single core. Two cores were dedicated to DPDK.  
While storage was not relevant for our purposes, an LVM logical group was created for every VM, instead of using files or even worse, sparse qcow2 images.

## Guest OS setup
Each VCPU was pinned to an isolated physical core, RAM was backed by 1 GB hugepages and VirtIO drivers and peripherals were used when possible.  
2 CPU and 4 GB RAM were given to each VM.  
The [FreeBSD wiki](https://wiki.freebsd.org/NetworkPerformanceTuning) suggests disabling entropy harvesting when doing benchmarks, so I did it by adding `harvest_mask="351"` in */etc/rc.conf*.  
The idea makes sense, even if I didn't find a way to do the same under Linux.

Linux is a fresh Fedora 29 install with a vanilla 4.19 kernel recompiled with the Fedora config just to make it possible to unload *iptables_filter*:

```
root@fedora1:~# uname -a
Linux fedora1 4.19.0-matteo #1 SMP Tue Oct 23 00:50:44 CEST 2018 x86_64 x86_64 x86_64 GNU/Linux
root@fedora1:~# grep '^model name' /proc/cpuinfo
model name      : Intel Core Processor (Skylake)
model name      : Intel Core Processor (Skylake)
root@fedora1:~# grep -E '^Mem(Total|Available)' /proc/meminfo
MemTotal:        4037340 kB
MemAvailable:    3652888 kB

root@fedora1:~# lspci -nn
00:00.0 Host bridge [0600]: Intel Corporation 440FX - 82441FX PMC [Natoma] [8086:1237] (rev 02)
00:01.0 ISA bridge [0601]: Intel Corporation 82371SB PIIX3 ISA [Natoma/Triton II] [8086:7000]
00:01.1 IDE interface [0101]: Intel Corporation 82371SB PIIX3 IDE [Natoma/Triton II] [8086:7010]
00:01.3 Bridge [0680]: Intel Corporation 82371AB/EB/MB PIIX4 ACPI [8086:7113] (rev 03)
00:02.0 Ethernet controller [0200]: Red Hat, Inc. Virtio network device [1af4:1000]
00:05.0 SCSI storage controller [0100]: Red Hat, Inc. Virtio block device [1af4:1001]
00:06.0 SCSI storage controller [0100]: Red Hat, Inc. Virtio block device [1af4:1001]
00:08.0 Unclassified device [00ff]: Red Hat, Inc. Virtio RNG [1af4:1005]
```

FreeBSD is 11.2-p4:

```
root@freebsd1:~# uname -a
FreeBSD freebsd1 11.2-RELEASE-p4 FreeBSD 11.2-RELEASE-p4 #0: Thu Sep 27 08:16:24 UTC 2018 root@amd64builder.daemonology.net:/usr/obj/usr/src/sys/GENERIC  amd64
root@freebsd1:~# sysctl hw.model hw.ncpu hw.physmem hw.usermem hw.realmem
hw.model: Intel Core Processor (Skylake)
hw.ncpu: 2
hw.physmem: 4277608448
hw.usermem: 3704823808
hw.realmem: 4294967296

root@freebsd1:~# lspci -nn
00:00.0 Host bridge [0600]: Intel Corporation 440FX - 82441FX PMC [Natoma] [8086:1237] (rev 02)
00:01.0 ISA bridge [0601]: Intel Corporation 82371SB PIIX3 ISA [Natoma/Triton II] [8086:7000]
00:01.1 IDE interface [0101]: Intel Corporation 82371SB PIIX3 IDE [Natoma/Triton II] [8086:7010]
00:01.3 Bridge [0680]: Intel Corporation 82371AB/EB/MB PIIX4 ACPI [8086:7113] (rev 03)
00:02.0 Ethernet controller [0200]: Red Hat, Inc. Virtio network device [1af4:1000]
00:04.0 Communication controller [0780]: Red Hat, Inc. Virtio console [1af4:1003]
00:05.0 SCSI storage controller [0100]: Red Hat, Inc. Virtio block device [1af4:1001]
00:06.0 SCSI storage controller [0100]: Red Hat, Inc. Virtio block device [1af4:1001]
00:08.0 Unclassified device [00ff]: Red Hat, Inc. Virtio RNG [1af4:1005]
```

Again, Spectre and Meltdown were disabled in the guest OS:

```
root@fedora1:/sys/devices/system/cpu/vulnerabilities# grep . *
meltdown:Vulnerable
spec_store_bypass:Vulnerable
spectre_v1:Mitigation: __user pointer sanitization
spectre_v2:Vulnerable

root@freebsd1:~# sysctl vm.pmap.pti hw.ibrs_disable hw.ibrs_active
vm.pmap.pti: 0
hw.ibrs_disable: 1
hw.ibrs_active: 0
```

## Syscall overhead
Before starting the network tests I wanted to measure the overhead of syscall invocation, as every I/O operation would trigger at least one.

I wrote some C code to measure the syscall overhead of the OS:

```c
/* Doesn't work on BSD because it triggers a SIGSYS which invalidates the
 * measurement. Replace syscall(-1) with getuid() to have a similar effect.
 */

for (i = 0; i < 10000000; i++) {
	time = __rdtscp(&junk);
	syscall(-1L);
	time = __rdtscp(&junk) - time;

	if (time < min)
		min = time;
}
printf("ctx: %llu clocks\n", min);
```

Basically it does millions of syscalls in a loop measuring the elapsed time by reading the *TSC* register.
The `syscall(-1)` call which I used on Linux triggered a `SIGSYS` signal on FreeBSD, which enters a very slow code path, so I switched to a slightly less accurate `getuid()`, which is a trivial syscall. The results of the two runs are:

```
root@fedora1:~# ./ctx_time
ctx: 243 clocks

root@freebsd1:~# ./ctx_time
ctx: 281 clocks
```

A similar test can be done with `dd bs=1` which performs two syscalls for every byte copied.

```
root@fedora1:~# dd if=/dev/zero of=/dev/null bs=1 count=10M
10485760+0 records in
10485760+0 records out
10485760 bytes (10 MB, 10 MiB) copied, 3.40924 s, 3.1 MB/s

root@freebsd1:~# dd if=/dev/zero of=/dev/null bs=1 count=10M
10485760+0 records in
10485760+0 records out
10485760 bytes transferred in 4.007083 secs (2616806 bytes/sec)
```

The results of both tests are consistent, a syscall on FreeBSD has roughly 16% more overhead than on Linux.

## Network with VirtIO drivers
As a first test, [iPerf](https://iperf.fr/) and [netperf](https://hewlettpackard.github.io/netperf/) were used. Traffic was generated between Linux guests and later between FreeBSD guests. Obviously tests were not running in parallel.

TCP test with iperf3

```
root@fedora1:~# iperf3 -c fedora2
Connecting to host fedora2, port 5201
[  5] local 192.168.124.11 port 38830 connected to 192.168.124.12
[ ID] Interval      Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   1.50 GBytes  12.9 Gbits/sec    1    403 KBytes
[  5]   1.00-2.00   1.48 GBytes  12.7 Gbits/sec    0    403 KBytes
[  5]   2.00-3.00   1.61 GBytes  13.9 Gbits/sec    0    594 KBytes
[  5]   3.00-4.00   1.57 GBytes  13.5 Gbits/sec    0    594 KBytes
[  5]   4.00-5.00   1.50 GBytes  12.9 Gbits/sec    0    594 KBytes
[  5]   5.00-6.00   1.57 GBytes  13.5 Gbits/sec    0    594 KBytes
[  5]   6.00-7.00   1.50 GBytes  12.9 Gbits/sec    0    594 KBytes
[  5]   7.00-8.00   1.49 GBytes  12.8 Gbits/sec    0   1.03 MBytes
[  5]   8.00-9.00   1.50 GBytes  12.9 Gbits/sec    0   1.03 MBytes
[  5]   9.00-10.00  1.49 GBytes  12.8 Gbits/sec   24    744 KBytes
- - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval      Transfer     Bitrate         Retr
[  5]   0.00-10.00  15.2 GBytes  13.1 Gbits/sec   25        sender
[  5]   0.00-10.04  15.2 GBytes  13.0 Gbits/sec             receiver

root@freebsd1:~# iperf3 -c freebsd2
Connecting to host freebsd2, port 5201
[  5] local 192.168.124.21 port 35815 connected to 192.168.124.22
[ ID] Interval     Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   713 MBytes  5.98 Gbits/sec   205    783 KBytes
[  5]   1.00-2.00   845 MBytes  7.09 Gbits/sec  1662    665 KBytes
[  5]   2.00-3.00   850 MBytes  7.13 Gbits/sec  1814    934 KBytes
[  5]   3.00-4.00   565 MBytes  4.74 Gbits/sec  1204   1.03 MBytes
[  5]   4.00-5.00   852 MBytes  7.14 Gbits/sec  2553    684 KBytes
[  5]   5.00-6.00   849 MBytes  7.13 Gbits/sec  1615    961 KBytes
[  5]   6.00-7.00   569 MBytes  4.77 Gbits/sec  1188   1.07 MBytes
[  5]   7.00-8.00   848 MBytes  7.11 Gbits/sec  2659    885 KBytes
[  5]   8.00-9.00   852 MBytes  7.14 Gbits/sec  2425    558 KBytes
[  5]   9.00-10.00  847 MBytes  7.11 Gbits/sec  1829    905 KBytes
- - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval     Transfer     Bitrate         Retr
[  5]   0.00-10.00 7.61 GBytes  6.53 Gbits/sec  17154       sender
[  5]   0.00-10.01 7.61 GBytes  6.53 Gbits/sec            receiver
```

UDP test with iperf3

```
root@fedora2:~# iperf3 -s
-----------------------------------------------------------
Server listening on 5201
-----------------------------------------------------------
Accepted connection from 192.168.124.11, port 38832
[  5] local 192.168.124.12 port 5201 connected to 192.168.124.11 port 34371
[ ID] Interval    Transfer     Bitrate         Lost/Total Datagrams
[  5]   0.00-1.00  275 MBytes  2.31 Gbits/sec  310230/509231 (61%)
[  5]   1.00-2.00  288 MBytes  2.42 Gbits/sec  319193/527800 (60%)
[  5]   2.00-3.00  286 MBytes  2.40 Gbits/sec  322674/529772 (61%)
[  5]   3.00-4.00  286 MBytes  2.40 Gbits/sec  322497/529719 (61%)
[  5]   4.00-5.00  289 MBytes  2.42 Gbits/sec  318181/527146 (60%)
[  5]   5.00-6.00  284 MBytes  2.38 Gbits/sec  326001/531413 (61%)
[  5]   6.00-7.00  285 MBytes  2.39 Gbits/sec  322854/529454 (61%)
[  5]   7.00-8.00  287 MBytes  2.40 Gbits/sec  320977/528570 (61%)
[  5]   8.00-9.00  294 MBytes  2.47 Gbits/sec  308189/521425 (59%)
[  5]   9.00-10.00 285 MBytes  2.39 Gbits/sec  323204/529912 (61%)
[  5] 10.00-10.04 10.8 MBytes  2.28 Gbits/sec  13636/21470 (64%)
- - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval     Transfer     Bitrate         Lost/Total Datagrams
[  5]   0.00-10.04 2.80 GBytes  2.40 Gbits/sec  3207636/5285912(61%)

root@freebsd2:~# iperf3 -s
-----------------------------------------------------------
Server listening on 5201
-----------------------------------------------------------
Accepted connection from 192.168.124.21, port 10172
[  5] local 192.168.124.22 port 5201 connected to 192.168.124.21
[ ID] Interval     Transfer    Bitrate         Lost/Total Datagrams
[  5]   0.00-1.00  58.9 MBytes  494 Mbits/sec  0/42301 (0%)
[  5]   1.00-2.00  64.7 MBytes  543 Mbits/sec  0/46472 (0%)
[  5]   2.00-3.00  64.5 MBytes  541 Mbits/sec  0/46347 (0%)
[  5]   3.00-4.00  64.6 MBytes  542 Mbits/sec  0/46381 (0%)
[  5]   4.00-5.00  64.7 MBytes  542 Mbits/sec  0/46446 (0%)
[  5]   5.00-6.00  64.7 MBytes  542 Mbits/sec  0/46441 (0%)
[  5]   6.00-7.00  64.4 MBytes  540 Mbits/sec  0/46226 (0%)
[  5]   7.00-8.00  64.8 MBytes  543 Mbits/sec  0/46506 (0%)
[  5]   8.00-9.00  64.8 MBytes  544 Mbits/sec  0/46542 (0%)
[  5]   9.00-10.00 64.8 MBytes  544 Mbits/sec  0/46551 (0%)
[  5]  10.00-10.09 5.85 MBytes  542 Mbits/sec  0/4200 (0%)
- - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval     Transfer    Bitrate         Lost/Total Datagrams
[  5]   0.00-10.09  647 MBytes  538 Mbits/sec  0/464413 (0%)
```

TCP test with netperf

```
root@fedora1:~# netperf -H fedora2 -t TCP_STREAM
Recv   Send    Send
Socket Socket  Message  Elapsed
Size   Size    Size     Time     Throughput
bytes  bytes   bytes    secs.    10^6bits/sec

 65536  32768  32768    10.00    12612.46
 
root@freebsd1:~# netperf -H freebsd2 -t TCP_STREAM
Recv   Send    Send
Socket Socket  Message  Elapsed
Size   Size    Size     Time     Throughput
bytes  bytes   bytes    secs.    10^6bits/sec
 65536  32768  32768    10.20    1233.02
```

UDP test with netperf

```
root@fedora1:~# netperf -H fedora2 -t UDP_STREAM
Socket  Message  Elapsed      Messages
Size    Size     Time         Okay Errors   Throughput
bytes   bytes    secs            #      #   10^6bits/sec
  9216    9216   10.00     1809700      0    13342.52
 42080           10.00     1769508           13046.20
 
root@freebsd1:~# netperf -H freebsd2 -t UDP_STREAM
Socket  Message  Elapsed      Messages
Size    Size     Time         Okay Errors   Throughput
bytes   bytes    secs            #      #   10^6bits/sec
  9216    9216   10.03     1377361      0    10126.59
 42080           10.03     1374845           10108.09
```

The smarter readers will note that the Linux buffer sizes are different from the ones on your distro. This is because I changed the Linux values to match the FreeBSD ones with this sysctl, even if the difference was negligible:

```
net.ipv4.tcp_rmem = 4096 65536 6291456
net.ipv4.tcp_wmem = 4096 32768 6291456
net.core.wmem_default = 9216
net.core.rmem_default = 42080
```

At first look, FreeBSD performance looks disastrous, so I've shared my results with the #freebsd folks on IRC, and they told me that slow VirtIO drivers for FreeBSD are a known issue. Not a big deal then, KVM was developed on Linux and sure Linux guest drivers are more optimized.
I changed the VM setup to use an emulated Intel Gigabit ethernet or Realtek rtl8139, but I get very poor results from both OSes so I don't even report them.
So I did the test again on the loopback interface on both guests. It's not a very professional test, but at least I'm not facing any VirtIO deficiency.
To make the test fair, I lowered the Linux MTU to 16384 as this is the maximum allowed on FreeBSD loopback device.

```
root@fedora1:~# iperf3 -s &
-----------------------------------------------------------
Server listening on 5201
-----------------------------------------------------------
root@fedora1:~# iperf3 -c 127.0.0.1 >/dev/null
Accepted connection from 127.0.0.1, port 48438
[  5] local 127.0.0.1 port 5201 connected to 127.0.0.1 port 48440
[ ID] Interval           Transfer     Bitrate
[  5]   0.00-1.00   sec  5.68 GBytes  48.8 Gbits/sec
[  5]   1.00-2.00   sec  6.05 GBytes  52.0 Gbits/sec
[  5]   2.00-3.00   sec  6.00 GBytes  51.5 Gbits/sec
[  5]   3.00-4.00   sec  6.12 GBytes  52.6 Gbits/sec
[  5]   4.00-5.00   sec  6.15 GBytes  52.8 Gbits/sec
[  5]   5.00-6.00   sec  6.11 GBytes  52.5 Gbits/sec
[  5]   6.00-7.00   sec  6.10 GBytes  52.4 Gbits/sec
[  5]   7.00-8.00   sec  6.07 GBytes  52.2 Gbits/sec
[  5]   8.00-9.00   sec  6.06 GBytes  52.0 Gbits/sec
[  5]   9.00-10.00  sec  6.01 GBytes  51.7 Gbits/sec
[  5]  10.00-10.04  sec   246 MBytes  52.4 Gbits/sec
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate
[  5]   0.00-10.04  sec  60.6 GBytes  51.9 Gbits/sec        receiver

root@freebsd1:~# iperf3 -s &
-----------------------------------------------------------
Server listening on 5201
-----------------------------------------------------------
root@freebsd1:~# iperf3 -c 127.0.0.1 >/dev/null
Accepted connection from 127.0.0.1, port 50250
[  5] local 127.0.0.1 port 5201 connected to 127.0.0.1 port 50251
[ ID] Interval           Transfer     Bitrate
[  5]   0.00-1.00   sec  1.89 GBytes  16.2 Gbits/sec
[  5]   1.00-2.00   sec  2.65 GBytes  22.8 Gbits/sec
[  5]   2.00-3.00   sec  2.67 GBytes  22.9 Gbits/sec
[  5]   3.00-4.00   sec  2.68 GBytes  23.1 Gbits/sec
[  5]   4.00-5.00   sec  2.66 GBytes  22.9 Gbits/sec
[  5]   5.00-6.00   sec  2.66 GBytes  22.8 Gbits/sec
[  5]   6.00-7.00   sec  2.66 GBytes  22.8 Gbits/sec
[  5]   7.00-8.00   sec  2.66 GBytes  22.8 Gbits/sec
[  5]   8.00-9.00   sec  2.62 GBytes  22.5 Gbits/sec
[  5]   9.00-10.00  sec  2.68 GBytes  23.0 Gbits/sec
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate
[  5]   0.00-10.00  sec  25.8 GBytes  22.2 Gbits/sec        receiver
```

An asciinema recording of one of the benchmarking sessions is here:

<script src="https://asciinema.org/a/204316.js" id="asciicast-204316" async="true"></script>

## Physical interface test
So, I finally made up my mind and prepared a more professional and precise test.

Xeon processors from Broadwell on, have a feature named [Posted Interrupts](https://software.intel.com/sites/default/files/managed/c5/15/vt-directed-io-spec.pdf).
This feature allows a guest OS to receive interrupts from a device, without passing through the hypervisor. [KVM supports this since 2013](https://git.kernel.org/linus/5a71785dde307f6ac80e83c0ad3fd694912010a1), and by doing this, performance of a device passed via PCI passthrough is identical to bare metal:

> Although close to bare metal, the average interrupt invocation latency of KVM+DID is 0.9µs higher.  
> […]  
> As a result, there is no noticeable difference between the packet latency of the SRIOV-BM configuration and the SRIOV-DID configuration, because the latter does not incur a VM exit on interrupt delivery.

(See [A Comprehensive Implementation and Evaluation of Direct Interrupt Delivery](https://compas.cs.stonybrook.edu/~mferdman/downloads.php/VEE15_Comprehensive_Implementation_and_Evaluation_of_Direct_Interrupt_Delivery.pdf))

So I got some Intel 82599ES 10 Gigabit cards as suggested by the [FreeBSD Network Performance Tuning](https://wiki.freebsd.org/NetworkPerformanceTuning), another identical server and I connected the servers back to back with this setup.

```
          +----------------+           +----------------+
          |                |           |                |
          |       NIC2-----+--<--<--<--+-----NIC1       |
          |                |           |                |
          |     Server     |           |     TRex       |
          |                |           |                |
          |       NIC3-----+-->-->-->--+-----NIC4       |
          |                |           |                |
          +----------------+           +----------------+
```

The server was running a single Linux or FreeBSD machine at once with PCIe passthrough, while another server is running TRex bound to two 10 Gbit cards.
[TRex](https://trex-tgn.cisco.com/) is a powerful DPDK based traffic generator which is capable of generating dozens of millions of packets per second. It can easily achieve line rate with 10 Gbit cards by sending 64 byte frames from 4 CPU.
TRex sends 10 Gbit (14.8 millions of 64 byte packets) per second from NIC1, packets are received from NIC2, get handled by the OS under test, which sends the packets to NIC3, and finally the packets go back to TRex, which checks them and makes statistics.
With this setup and PCI passthrough, test results became more stable and reproducible between different runs, so I assume that this is the correct way to do it.
Each test was repeated ten times, the graph line plots the average, while min and max values are reported with candlesticks.

First test is a software bridge. The two interfaces are bridged and packets are just forwarded.

{{< figure src="bridge.png" caption="L2 forwarding" >}}

The first thing that struck me, is that FreeBSD packet rate was substantially the same with one or 8 CPUs.
I investigated a bit, and I've found it to be a known issue: bridging under FreeBSD is known to be slow because
the *if_bridge* driver is practically monothread due to excessive locking, as written in the [FreeBSD network optimization guide](https://wiki.freebsd.org/NetworkPerformanceTuning).

The second thing that I noted is that when running a test on a single core FreeBSD guest,
the system freezes until traffic is stopped. It only happens to FreeBSD when the guest has only one core.  
Initially I thought that it could be a glitch of the serial or tty driver,
but then I ran a `while sleep 1; do date; done` loop, and if it was just an output issue, the time wouldn't freeze.
I looked in all the sysctl to find if the FreeBSD kernel was preemptible, and it is, so I can't explain what is going on.  
I made an asciinema which better illustrates this weird behavior.

<script src="https://asciinema.org/a/205477.js" id="asciicast-205477" async="true"></script>

Second test is routing. Two IP addresses belonging to different networks are assigned to the interfaces, and the TRex NIC4 address is set as default route. TRex is sending packets to the first interface and packets are forwarded.

{{< figure src="routing.png" caption="L3 routing" >}}

When talking about L3 forwarding both OSes scale quite well. While achieving more or less the same performance with a single core, Linux does a better job with multiple processors.

Third test is about firewall. The setup is the same as the routing test, except that some firewall rules are loaded in the firewall.
The rules are generated in a way that they can't match any packets sent from TRex (different port range than the generated traffic), they are here only to add weight.
We know that both OSes have two firewall systems, Linux has iptables and nftables, while FreeBSD has PF and IPFW. I tested all of them and in the graph below I report performances for iptables and IPFW because they proved faster than the other two solutions.

{{< figure src="firewall.png" caption="packet filtering" >}}

As said before, I deliberately omitted the nftables and PF numbers to avoid confusion. If you want to see all the numbers, here are the [raw data](https://docs.google.com/spreadsheets/d/e/2PACX-1vQqhCYLDEyngnWJAcBV4xahScYXt_edKL-HDxzsdIjuTIdg8LOdYZU1hvcwklJ_Np1aaLmP0fzrzOz5/pubhtml?gid=1147998389&single=true).

## Conclusions
Both OSes perform well, being able to forward more than 1 million pps per core, which lets you achieve the 10 Gbit line rate with 1500-byte frames.
FreeBSD scales relatively well with core numbers (except in bridge mode which is kinda monothread), but Linux does a near perfect job using all the power of a multicore system. The same applies to firewalling, where we can see that a large firewall ruleset can disrupt the performance of both kernels, unless using tricks like fastpath and HW offloading.
