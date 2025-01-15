+++
title = "TP-Link configuration file decrypt"
date = "2014-05-31T12:00:00+01:00"
description = "Decrypting TP-Link configuration files"
tags = ["hacking"]
+++

Some routers allow you to save and restore the configuration from a file locally.
This is nice because by saving the configuration, altering the file and uploading it again,
you can change settings not exposed in the interface.  
For example, on my [D-Link DSL-2640B](https://www.dlink.com/uk/en/products/dsl-2640b-adsl-2-wireless-g-router-with-4-port-10-100-switch)
I could disable a broken QoS which was slowing down the download speed just by setting `X_BROADCOM_COM_ATMEnbQos` to FALSE.

When I got a TP-Link wireless access point, I tried the same trick but I've found that they started encrypting the configuration file, making it impossible to edit manually.  

So I decided to reverse engineer it.

First of all I needed a dump of the filesystem to get the binaries, so I soldered a serial port on the router to access the bootloader.  
The bootloader doesn't allow you to interrupt the boot process but luckily I knew that on those devices you can get a prompt by typing the secret word *tpltpltpl*.

```
AP93 (ar7240) U-boot
DRAM:
sri
#### TAP VALUE 1 = 9, 2 = 9
32 MB
id read 0x100000ff
flash size 4194304, sector count = 64
Flash:  4 MB
Using default environment

In:    serial
Out:   serial
Err:   serial
Net:   ag7240_enet_initialize...
No valid address in Flash. Using fixed address
: cfg1 0xf cfg2 0x7014
eth0: 00:03:7f:09:0b:ad
eth0 up
No valid address in Flash. Using fixed address
: cfg1 0xf cfg2 0x7214
eth1: 00:03:7f:09:0b:ad
ATHRS26: resetting s26
ATHRS26: s26 reset done
eth1 up
eth0, eth1
Autobooting in 1 seconds
ar7240>
```

I've compiled an OpenWrt initramfs image and loaded it via tftp:

```
ar7240> tftp 0x81000000 openwrt-ar71xx-generic-tl-wr841n-v8-initramfs-uImage.bin
ar7240> bootm
```

Booting an initramfs firmware gives you a running Linux system with root access,
but without altering anything on the flash.  
At this point it's possible to dump the root partition and then get it via SSH:

```
# cat /dev/block/mtd2 >/tmp/rootfs
# scp /tmp/rootfs matteo@192.168.1.2:
```

The filesystem is an ancient squashfs version, unsupported by modern squashfs tools, so I had to compile an old release to extract it with *unsquashfs*.

In the extracted filesystem, I located the directory containing the web interface pages.
Looking at the web page which handles the configuration,
I noticed some custom tags that refer to some sort of embedded functions.
Most likely they are handled server-side by the webserver.  
The webserver is an "httpd" binary which has many symlinks pointing to it, so it can provide many utilities.
This is a common practice in limited constrained systems, most notably in the BusyBox project.

I started IDA to look at this binary, clearly `httpConfUpload` was the function to start hacking from.

{{< figure src="ida.png" >}}

Given a reference to `des_min_do` and some strings starting with *DES_*, I suspected that *DES* is the cipher used to encrypt the file.  
Furthermore, it has a lot of bitwise operators and loops, common for cryptographic functions:

{{< figure src="des_min_do.png" >}}

Before calling this function, a pointer to a constant null-terminated string is pushed onto the stack.
It could be some salt or key passed to the encryption function as an argument so I noted this string which was **478DA50BF9E3D2CF**.

{{< figure src="key.png" >}}

I tried to decrypt it with mdecrypt using that string as key but without success:

```
$ mdecrypt -b -a des -f key <config.bin
```

I looked again at the binary and, searching for the _des string, I found `md5_des` which led me to use the md5 hash function:

```
$ mdecrypt -b -a des -f key -o mcrypt-md5 <config.bin
```

Again no luck, so I tried all the block modes available until I found that the correct one was *ecb*:

```
$ mdecrypt -b -a des -m ecb -f key -o mcrypt-md5 <config.bin
????????????????lan_ip 192.168.1.254
lan_msk 255.255.255.0
lan_gateway 0.0.0.0
```

The file is decrypted! The garbage before the plain text is the md5 of the file,
if I calculate it with my hex editor it matches:

{{< figure src="md5.png" >}}

The same can be done with openssl:

```
$ openssl enc -d -des-ecb -nopad -K 478DA50BF9E3D2CF -in config.bin
```

I succeeded in decrypting the TP-Link configuration file, now it's possible to edit it manually.  
Have fun!
