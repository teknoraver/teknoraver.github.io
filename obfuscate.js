// Simple obfuscation of an email address
address = "mailto:example@example.com";
sorted = address;
sorted = sorted.split("");
sorted = sorted.sort();
sorted = sorted.filter((v, i) => sorted.indexOf(v) === i);

obfaddress = sorted.join("");
offsets = [];

for (i = 0; i < address.length; i++)
	offsets.push(sorted.indexOf(address[i]));
