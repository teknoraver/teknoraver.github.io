+++
title = "Wireless Paper Scanner"
date = "2026-01-27T02:06:00+01:00"

description = "Turning the WPS button into a paper scanner"

tags = ["linux","networking","programming","embedded","scanning"]
+++

# Turning the WPS button into a scanner

I've been an OpenWrt user since 2003, and when I had a DSL line I was using a
[TP-Link TD-W8970](https://openwrt.org/toh/tp-link/td-w8970_v1).
That cheap device had a Lantiq modem which was fully supported by open source drivers,
a decent Wi-Fi radio, and nice features for the price.

One of the features I liked the most about that router was its USB ports.  
As soon as I had it working I moved my USB printer from the computer to the router,
so I could print from any device without powering on my computer.  
At some point I thought: why not do the same with the flatbed scanner?
I just needed to find a way to trigger the scan without a computer.  
Like many routers it had a **WPS** button, which I never used because I keep a QR code with the Wi-Fi credentials hanging on the wall.  
From that moment on, WPS no longer meant *Wi-Fi Protected Setup*, but stood for **Wireless Paper Scanner**
(to be honest, calling it *Worst Possible Scanner* would also have been technically accurate).

This reminds me of a quote I read in the chemistry set manual I had as a kid:
"A real scientist can use a tool in ways different from its original, intended purpose."

## The idea

The router was always on, already sitting next to my printer,
and OpenWrt makes it trivial to react to hardware buttons.
The WPS button was just there. Unused. Unsatisfied.

In OpenWrt, button presses are handled by scripts in `/etc/rc.button/`. Press a button, a shell script runs. Easy.  
The default handler for the WPS button was invoking a hostapd_cli command to start the WPS handshake,
so my plan was to replace that with a script which triggers a scan and emails me the document.  
No web UI or other useless frills, I'm a simple guy.

## The hard constraint: read-only filesystem and 64 MB of RAM

My first attempt was to just write a script that scans a page, saves it somewhere, and emails it as an attachment.
I created the script, pressed the button, and in the middle of the scan things blew up spectacularly.  
OpenWrt usually runs from a read-only squashfs filesystem, so I placed the scanned image in `/tmp`,
which is a [tmpfs](https://en.wikipedia.org/wiki/Tmpfs) filesystem.  
But that router had a total of **64 MB of RAM** and I underestimated how much memory a full-page color scan would need.  
Spoiler: roughly 100 MB.

The [SANE](http://www.sane-project.org/) CLI front-end, `scanimage`, could only output *PNM* images. That's an uncompressed image format
which is fine if you have disk space or memory, but I didn't have either.

## Streaming or death

The only way this could work was streaming: no temporary files, no full image in memory, data flowing directly from the scanner into the email.  
That meant two things: `scanimage` had to output a *compressed* format, compression had to happen while scanning, not after.  
Unfortunately, `scanimage` didn't support that. So I decided that I would implement it myself.

## First attempt: PNG

My first task was adding *PNG* support to `scanimage`.

I chose PNG because it's lossless and widely supported, and I thought it would compress well enough. 
So I integrated [libpng](http://www.libpng.org/pub/png/libpng.html) into `scanimage`,
and hooked it up so that the tool could output PNG images directly on stdout while scanning.

I was optimistic enough to avoid testing the size of a scanned PNG image before doing the actual work.
So I obtained the same out-of-memory failure as before, just a bit later.

At that point I remembered a meme: ["never shall defeat be in the heart of a warrior"](https://imgflip.com/i/ahbqle).

However, I was quite proud of that patch so I submitted it and
[it got merged](https://gitlab.com/sane-project/backends/-/commit/c83123ee469a8b5d4df24fbfb07f0abcf794cdbb).

## Second attempt: JPEG

So I decided to do things the right way this time: I measured the size of
a scanned *JPEG* image and I calculated that it would be small enough to be held in memory.

So I sat down and added JPEG support to `scanimage` too, similarly to what I did for PNG.
This actually worked: the script was scanning a document and producing a JPEG image
which could stay in `/tmp` without running out of memory.

Since the JPEG scan was working so well, I submitted that patch too, and
[it got merged as well](https://gitlab.com/sane-project/backends/-/commit/bc698d4329c9fa184137399442b318a650061db9).

## The final script

Now I just needed an SMTP client to email the scanned image as an attachment.
OpenWrt already included a tiny `sendmail` implementation, so I just needed to write a script
which generates a proper MIME email with the scanned image as an attachment.

At first, my plan was still to store the image in `/tmp` and then attach it to an email,
but soon I faced another memory issue: encoding the image in base64 requires roughly 33% more memory than the original image,
but I didn't have space for two copies of the image: one for the file, and one for its base64 encoding in the MIME message.

At that point it was clear that storing the scan anywhere was a luxury I couldn't afford,
I had to stream the entire email as well.

I couldn't find any existing tool that could stream MIME messages,
so I had to create my own.  
Surprisingly, it was small enough to be posted here in full. Here is the mailer script:

```sh
#!/bin/sh

[ $# -ne 1 ] && exec echo "Usage: $0 <address>"
boundary=$(hexdump -n16 -e '1 "%02x"' /dev/urandom)
date=$(date '+%d-%m-%Y %R')

{
cat <<EOF
From: Scan
To: $1
Subject: Scan $date
MIME-Version: 1.0
Content-Type: Multipart/Mixed; boundary="$boundary"

--$boundary
Content-Disposition: inline
Content-Transfer-Encoding: 7bit

Attached
--$boundary
Content-Type: image/jpeg
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="scan-$date.jpg"

EOF
scanimage --mode Color --format jpeg |base64
echo "--$boundary--"
} |sendmail "$1"
```

I generated a random MIME boundary with `hexdump`, created the email headers,
and then streamed the scanned image directly into `base64`, piping the result into `sendmail`.

In this way, the entire process was streaming from end to end, no image or email was ever fully in memory.
Not in its entirety, at least.

The data flows directly from the scanner, through the JPEG encoder, into base64, and straight into SMTP.

Finally, I replaced the default WPS button handler script with one which just calls this mailer script with my email address.

## Beyond the scanner

This project led me down a rabbit hole of improvements to SANE.

I had to run `saned` (the SANE network daemon) in the router to access the scanner,
but it lacked an option to bind to a specific address.
Since my router had a public IP address, I didn't want to expose the scanner to the entire internet.
So I wanted to add a `-b` option to bind to localhost only.

But then I discovered that `saned` wasn't using `getopt()` for argument parsing,
which made it awkward to add new options.
So I refactored the argument parsing to use `getopt_long()`,
cleaned up the code structure, and then added the bind option.

In the end, I contributed [seven patches to SANE](https://gitlab.com/sane-project/backends/-/commits/master?author=Matteo%20Croce):
two for the image formats I needed, and five more to make the network daemon usable for my setup.

## The result

Now I have a wireless router with a WPS button that scans a document and emails it to me;
I can scan documents without even powering on my computer.

Looking back, this project captures what I like about OpenWrt and embedded Linux:
taking consumer hardware and making it do things the manufacturer never imagined.
A "proper" network scanner would have been easier, but far less interesting.

Every time I press the WPS button to scan a document,
I'm reminded that the best solutions often come from working within constraints
rather than throwing more hardware at the problem.

I also ended up contributing a few patches upstream, which was a nice side effect.
