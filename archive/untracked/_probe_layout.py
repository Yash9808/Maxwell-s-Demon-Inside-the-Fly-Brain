import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
i = h.find('function buildBrain(')
print('buildBrain at', i)
seg = h[i:i+6000]
print(seg[:6000])
