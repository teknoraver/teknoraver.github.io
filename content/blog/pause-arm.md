+++
title = "pause on ARM"
date = "2025-01-06T12:21:08+01:00"
description = "How sleeping indefinitely is implemented on ARM"
tags = ["linux", "arm"]
+++
I was tracing some syscalls to check when and how the `sleep` command was being executed.

I was expecting to see a call to `clock_nanosleep`, but instead I found a call to `ppoll(NULL, 0, NULL, NULL, 0)`, so I got curious.  
I filtered the running processes and I've found `sleep inf` running, so I've discovered that `sleep` supports the "inf" argument to sleep indefinitely.  
This was not documented in the man page, so I looked at [sleep source code](https://github.com/coreutils/coreutils/blob/master/src/sleep.c) to know more,
but in the code there were no references to the "inf" syntax, so I got even more curious.

I realized that `sleep` uses `strtod` to parse its arguments which,
[according to its man page](https://man7.org/linux/man-pages/man3/strtod.3p.html),
parses the "INF" or "INFINITY" string as the IEEE 754 special value for positive infinity (which is `0x7ff0000000000000`, btw).  
This value is passed to an internal helper called `xnanosleep`, which detects the infinite value and calls `pause()` to sleep forever.  
This is a very smart way to sleep indefinitely, instead of using a loop to call `sleep` in a cycle.

But why `ppoll` was being called instead of `pause`? Obviously, the result is the same, but why not just call `pause` directly?  
So I wrote this small tool to see what syscall was effectively being called:
```c
#include <unistd.h>

int main(void)
{
	pause();

	return 0;
}
```

The answer is: depends on the architecture. This happens on an ARM machine:
```
$ strace -e clock_nanosleep,ppoll,pause ./pause
ppoll(NULL, 0, NULL, NULL, 281473054674784
```
and this on an x86 machine:
```
$ strace -e clock_nanosleep,ppoll,pause ./pause
pause(
```

A quick look at the [kernel syscall source](https://github.com/torvalds/linux/blob/v6.12/kernel/signal.c#L4684-L4695)
shows that `pause` is available on architectures that define `__ARCH_WANT_SYS_PAUSE`, which is set for i386 and arm but not arm64.  
So, the `ppoll` call is a fallback for architectures that don't have the `pause` syscall, like arm64 and RISC-V.
