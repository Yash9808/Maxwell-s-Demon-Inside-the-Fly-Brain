import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
i = h.find('hulls: (typeof HULLS')
print(repr(h[i:i+260]))
print()
j = h.find('const a = Math.min(0.42,')
print(repr(h[j-120:j+320]))
