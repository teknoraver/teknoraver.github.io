+++
title = "Windows as QEMU guest"
date = "2020-10-29T12:00:00+01:00"
description = "A detailed, step by step guide on how to setup Windows as QEMU guest with accelerated drivers"
tags = ["windows","linux","vm"]
+++

Windows can run fine under QEMU and KVM, but since installing it with QEMU or libvirt directly is not very straightforward, most people prefer using other hypervisors which have a fancy GUI.

KVM is known to have the best performance as Linux host, and require no external drivers, and with [virt-manager](https://virt-manager.org/) it's not more difficult to setup than other solutions.

A proper Windows installation, with VirtIO drivers and guest tools, will run stable and perform almost as a physical machine.
This is how the system appears:

{{< figure src="/blog/windows_qemu/devices.png" >}}

## Get the software
Assuming that your Linux distribution has qemu, libvirt and virt-manager already installed, to proceed download the following:

* VirtIO drivers: get the "Stable virtio-win iso" from
https://docs.fedoraproject.org/en-US/quick-docs/creating-windows-virtual-machines-using-virtio-drivers/#virtio-win-direct-downloads
* Official Windows ISO install, get the latest from
https://www.microsoft.com/en-us/software-download/windows10ISO

Put both the ISO in a libvirt pool directory, like */var/lib/libvirt/images/*

## Prepare the VM
Create a new VM via the virt-manager wizard. Select the Windows ISO as install media and select the "Customize configuration before install" option. Be generous with the disk size, we'll find out how to avoid space waste later.

{{< figure src="/blog/windows_qemu/create1.png" >}}
{{< figure src="/blog/windows_qemu/create2.png" >}}
{{< figure src="/blog/windows_qemu/create3.png" >}}

At this point, we'll change the VM definition so to use the VirtIO drivers.

First, go to the disk drive, and set the bus to VirtIO. In the advanced options, set "discard mode" to unmap, to get rid of the virtualized TRIM command and discard the free space in the guest filesystem from the host.

{{< figure src="/blog/windows_qemu/trim.png" >}}

Set the NIC type to VirtIO as well, it has much better performances than emulating a physical card:

{{< figure src="/blog/windows_qemu/nic.png" >}}

To be able to install the VirtIO drivers during setup, add a secondary optical drive, with the virtio driver ISO we downloaded.

{{< figure src="/blog/windows_qemu/virtio_iso.png" >}}

In Windows, we may want to use Windows Hello for login using a PIN. This requires a TPM chip, but QEMU can present one to the guest, either software emulated via swtpm, or pass /dev/tpm0 in passthrough:

{{< figure src="/blog/windows_qemu/tpm1.png" >}}
{{< figure src="/blog/windows_qemu/tpm2.png" >}}


Not strictly necessary, but nice to have, QEMU can emulate an hardware watchdog to reboot the guest when it hangs.

{{< figure src="/blog/windows_qemu/watchdog.png" >}}

And a hardware RNG, to get entropy from the host.

{{< figure src="/blog/windows_qemu/rng.png" >}}

At this point, we're ready to start the install by clicking on "Begin Installation". Be sure to select BIOS as firmware, because [UEFI snapshots are not implemented yet](https://bugzilla.redhat.com/show_bug.cgi?id=1881850).

{{< figure src="/blog/windows_qemu/bios.png" >}}

## Windows installation
At this point the VM starts with the Windows installation running from the optical drive, until it stops because no disk drives are detected.

{{< figure src="/blog/windows_qemu/install_nodisk.png" >}}

Press the "load driver" button, and browse *E:\viostor\w10\amd64* to find the storage drivers for the virtio disk.

{{< figure src="/blog/windows_qemu/storage1.png" >}}
{{< figure src="/blog/windows_qemu/storage2.png" >}}

Now Windows with the virtio storage driver loaded, detects the virtual disk we created.

{{< figure src="/blog/windows_qemu/format.png" >}}

Use again the load driver function to install the network card. It's better to have a working connection during the installation steps.

{{< figure src="/blog/windows_qemu/network.png" >}}

Nitpick, loading the virtualized GPU drivers in this stage offers a more pleasant experience during installation

{{< figure src="/blog/windows_qemu/vga.png" >}}

Now finally start the installation and wait for it to complete, after some reboots.

## System setup
We installed very mandatory drivers during the installation, now let's install the optional ones. A convenient installer for all the virtio drivers and the guest agent is at the root of the virtio driver CD.
Guest agent allows to sync the clipboard between the host and guest.

{{< figure src="/blog/windows_qemu/booted.png" >}}

## Saving space
At this point Windows is ready to run. Since we use the virtio disk driver, the guest will report to the hypervisor the range of the free space in the filesystem. The hypervisor then will pass this information to QEMU, which will punch holes in the disk image, and free space on the host.
To maximize the savings, we can take some additional steps.

Windows keeps a *hiberfil.sys* file as big as the system ram to support hibernation. It's unlikely to use hibernation in a VM, given they can be paused, so disable it by running in an administrator command prompt `powercfg -h off`.

More free space can be gained by running the cleanup tool:
configure it once with `cleanmgr /sageset:0` and select all the checkboxes
then run it every time with `cleanmgr /sagerun:0`

{{< figure src="/blog/windows_qemu/cleanup1.png" >}}
{{< figure src="/blog/windows_qemu/cleanup2.png" >}}

Windows update stores some backup data to rollback upgrades. Again, it's unlikely to do it since we have VM snapshots, so this data can be freed by running in an administrator command prompt:

```
dism.exe /online /Cleanup-Image /StartComponentCleanup /ResetBase
```

{{< figure src="/blog/windows_qemu/dism.png" >}}

After we've done with all the cleaning, run the Optimize Drive utility from Explorer. Windows will detect the drive as "thin provisioned drive" and issue discards to the host instead of regular disk defragmenting.

{{< figure src="/blog/windows_qemu/optimize.png" >}}

After the trim is done, we should have that the disk image in the host is a sparse file, with the real size being much lower than the apparent one:

```
root@turbo:/var/lib/libvirt/images# ll win10.qcow2
-rw — — — -. 1 root root 101G ott 27 02:23 win10.qcow2

root@turbo:/var/lib/libvirt/images# du -sh win10.qcow2
13G win10.qcow2
```
