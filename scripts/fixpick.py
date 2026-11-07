import re, io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
s2 = re.sub(r"pick\(([^()]*?), rng\)", r"pick(rng, \1)", s)
io.open(p, "w", encoding="utf-8", newline="\n").write(s2)
print("pick(rng, count:", s2.count("pick(rng,"))
