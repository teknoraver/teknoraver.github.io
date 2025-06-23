+++
title = "C Cleanups"
date = "2025-06-22T00:40:53+02:00"
description = "C Cleanup attributes: a modern approach to resource management"
tags = ["c", "programming"]

+++

When I started contributing to systemd, I discovered a new C addition that I wouldn't like
to live without any more: cleanup attributes.  
This feature revolutionizes resource management,
eliminating the verbose error handling boilerplate that's been around for ages.  
Let me demonstrate why this is one of C's most significant improvements in years.

## The traditional approach: manual cleanup
Let's start with a practical example: a simple function that copies one file to another.  
In traditional C, this straightforward task requires a lot of manual resource management:

```c
int copy_classic(const char *src_path, const char *dst_path)
{
	int src, dst;
	char *buffer;
	int n;

	buffer = malloc(BUFFER_SIZE);
	if (!buffer)
		return 1;

	src = open(src_path, O_RDONLY);
	if (src < 0) {
		free(buffer);
		return 2;
	}

	dst = open(dst_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
	if (dst < 0) {
		close(src);
		free(buffer);
		return 3;
	}

	while (1) {
		n = read(src, buffer, BUFFER_SIZE);
		if (n == 0)
			break;
		if (n < 0) {
			close(dst);
			close(src);
			free(buffer);
			return 4;
		}

		if (write(dst, buffer, n) != n) {
			close(dst);
			close(src);
			free(buffer);
			return 5;
		}
	}

	close(dst);
	close(src);
	free(buffer);

	return 0;
}
```

While the program goes forward, the error paths become more and more complex,
adding more cleanup functions to release the newly allocated resources.  
It's repetitive, error-prone, and frankly, difficult to maintain: miss one cleanup call
and you've got a resource leak.  
Additionally, if you need to add a new return condition anywhere in the middle of the function,
you automatically introduce a resource leak unless you remember to add all the necessary cleanup calls.

**Pros**
* Absolutely no compiler extensions required, pure ISO C.
* Every action/result pair is explicit.

**Cons**
* Repetition hell:  same three cleanup calls in four different places.
* Easy to miss a branch the next time someone edits the loop.

## The Linux kernel approach: centralized cleanup with goto

The Linux kernel popularized a pattern using `goto` statements for centralized cleanup.  
While `goto` is generally discouraged in modern programming,
this specific use case actually makes the code more maintainable:

```c
int copy_goto(const char *src_path, const char *dst_path)
{
	int src, dst;
	char *buffer;
	int ret = 0, n;

	buffer = malloc(BUFFER_SIZE);
	if (!buffer) {
		ret = 1;
		goto out;
	}

	src = open(src_path, O_RDONLY);
	if (src < 0) {
		ret = 2;
		goto out_free;
	}

	dst = open(dst_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
	if (dst < 0) {
		ret = 3;
		goto out_src;
	}

	while (1) {
		n = read(src, buffer, BUFFER_SIZE);
		if (n == 0)
			break;
		if (n < 0) {
			ret = 4;
			goto out_dst;
		}

		if (write(dst, buffer, n) != n) {
			ret = 5;
			goto out_dst;
		}
	}

out_dst:
	close(dst);
out_src:
	close(src);
out_free:
	free(buffer);
out:
	return ret;
}
```

This is definitely better. We have centralized cleanup logic,
and it's much harder to forget to clean up a resource.  
However, it still requires careful ordering of the cleanup labels
and manual management of the cleanup flow.

**Pros**
* Single exit point, so far fewer chances to forget a cleanup.
* The labels document the ownership stack: buffer → src → dst.

**Cons**
* `goto` feels "dirty" to many developers

## The modern solution: cleanup attributes
Now, here's where cleanup attributes come into play.  
Cleanup attributes represent a significant evolution in C programming.
They bring the benefits of [RAII-style](https://en.wikipedia.org/wiki/Resource_acquisition_is_initialization)
resource management to C without requiring language changes or runtime overhead.  
The result is code that's not only more readable and maintainable but also dramatically
less prone to resource leaks and other common C pitfalls.  

Let's see how we can rewrite our file copy function using cleanup attributes:
first, we define our cleanup functions and some macros to simplify their usage:

```c
#define _cleanup_(x) __attribute__((__cleanup__(x)))
#define _cleanup_close_ _cleanup_(closep)
#define _cleanup_free_ _cleanup_(freep)

static inline void closep(int *fd)
{
	if (*fd >= 0)
		close(*fd);
}

static inline void freep(void *p)
{
	free(*(void **)p);
}
```

This is boilerplate code which we can put in a common header file.  
Then, we can rewrite our file copy function using these cleanup attributes:

```c
int copy_cleanups(const char *src_path, const char *dst_path)
{
	_cleanup_close_ int src = -EBADF, dst = -EBADF;
	_cleanup_free_ char *buffer = NULL;
	int n;

	buffer = malloc(BUFFER_SIZE);
	if (!buffer)
		return 1;

	src = open(src_path, O_RDONLY);
	if (src < 0)
		return 2;

	dst = open(dst_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
	if (dst < 0)
		return 3;

	while (1) {
		n = read(src, buffer, BUFFER_SIZE);
		if (n == 0)
			return 0;
		if (n < 0)
			return 4;

		if (write(dst, buffer, n) != n)
			return 5;
	}
}
```

Now, the cleanup logic is completely automated.
When any variable goes out of scope, whether through a normal return or an early
exit due to an error, the associated cleanup function is automatically called.

**Pros**
* Automatic cleanup: Resources freed when variables go out of scope
* Error-proof: Impossible to forget cleanup paths
* Conciseness: 50% smaller than traditional version
* Readability: Business logic isn't buried in cleanup

**Cons**
* Requires compiler support (GCC or Clang)
* Slightly less explicit than manual cleanup
* May not be familiar to all C programmers

## How cleanup attributes work

The magic happens through [GCC](https://gcc.gnu.org/onlinedocs/gcc/Common-Variable-Attributes.html#index-cleanup-variable-attribute)'s
(or [Clang](https://clang.llvm.org/docs/AttributeReference.html#cleanup)'s) `__cleanup__` attribute.
When you declare a variable with this attribute,
you specify a cleanup function that will be called automatically when the variable goes out of scope.
The cleanup function receives a pointer to the variable,
this is why we wrapped `free` and `close` into our `freep` and `closep` functions, which take a pointer and dereference it.

The key points to understand:

Automatic execution: Cleanup functions are called automatically when variables go out of scope.  
LIFO order: Cleanup functions are called in reverse order of declaration (last declared, first cleaned).  
Exception safety: Cleanup happens even on early returns or error conditions.  
Zero overhead: When compiled with optimizations, there's typically no runtime overhead.

## Best Practices and Considerations
Always initialize cleanup-managed variables with safe values.  
Notice how we initialize file descriptors to `-EBADF` and pointers to `NULL`.
This ensures that if the cleanup function is called before the resource is actually allocated,
it won't attempt to clean up an invalid resource.

### Design cleanup functions defensively
Your cleanup functions should always check if the resource needs cleaning up:

```c
static inline void closep(int *fd)
{
	if (*fd >= 0)  // Only close valid file descriptors
		close(*fd);
}

static inline void freep(void *p)
{
	free(*(void **)p);  // free() already handles NULL safely
}
```

### Returning pointers
You may ask, What if I need to return a pointer to a resource that I want to clean up later?  
Once the cleanup attribute is applied, the cleanup function is bound to the variable and it's
impossible to skip the cleanup call. So how to return a valid resource?  
The trick here is to invalidate the variable by setting it to a safe value which
the cleanup function recognizes as "nothing to clean up".  
In systemd we have some `TAKE_*` macros that do exactly this:

```c
#define TAKE_PTR(ptr) ({ \
	void *__ptr = (ptr); \
	(ptr) = NULL; \
	__ptr; \
})

#define TAKE_FD(fd) ({ \
	int __fd = (fd); \
	(fd) = -EBADF; \
	__fd; \
})
```

By "taking" the resource, we ensure that the cleanup function won't attempt to clean it up again:

```c
char *get_temp_file(void)
{
	_cleanup_free_ char *path = NULL;
	int ret;

	path = malloc(64);
	if (!path)
		return NULL;

	ret = snprintf(path, 64, "/tmp/tempfile-%d", getpid());
	if (ret < 0)
		return NULL;

	return TAKE_PTR(path);
}

int open_config(void)
{
	_cleanup_close_ int fd = -EBADF;
	char hdr[5];

	fd = open(".myconfig", O_RDONLY);
	if (fd < 0)
		fd = open("/etc/myconfig", O_RDONLY);

	if (fd < 0)
		return -1;

	if (read(fd, hdr, sizeof(hdr)) != sizeof(hdr))
		return -1; 	/* cleanup ACTUALLY closes fd */

	if (memcmp(hdr, "#CFG\n", 5) != 0)
		return -1;

	return TAKE_FD(fd);
}
```

### Consider creating cleanup helpers
For larger projects, consider creating a comprehensive set of cleanup functions for
common resource types. systemd, for example, has cleanup functions for file descriptors,
memory, file pointers, directory handles, and many more.

```c
// Cleanup for temporary files
static inline void unlink_temp(char **path)
{
	if (*path) {
		unlink(*path);
		free(*path);
	}
}
#define _cleanup_temp_ _cleanup_(unlink_temp)
```

## Conclusion
Even the Linux kernel [added support for cleanup attributes in June 2023](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=54da6a0924311c7cf5015533991e44fb8eb12773),
marking a major shift in how kernel developers approach resource management.  
The result is code that is more readable and maintainable, and less prone to resource leaks and other common C pitfalls.
If you can, I strongly encourage you to explore cleanup attributes. They changed how I approach C programming,
allowing me to write code that doesn't leak resources even when the error handling gets complex.  
And in a language like C, where manual resource management has been a source of bugs,
this is a huge achievement.
