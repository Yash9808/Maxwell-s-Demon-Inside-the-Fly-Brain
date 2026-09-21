import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
i = h.find('function anatFillPositions(')
print('anatFillPositions at', i)
print(h[i:i+5200])
