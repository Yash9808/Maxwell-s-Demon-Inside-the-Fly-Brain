import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
i = h.find('anatomical mapping')
seg = h[i-2600:i-400]
print(seg.replace('\r','').replace('\n',' | '))
