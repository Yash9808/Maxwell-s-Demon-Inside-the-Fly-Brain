import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
i = h.find('$("btnAnat").addEventListener')
seg = h[i:i+2200]
j = seg.find('btnAnat").classList.toggle')
# print handler fully
print('=== btnAnat handler (full) ===')
print(seg[:1500])
print('...')
# buildBrain tail
k = h.find('function buildBrain(')
k2 = h.find('return brainHolder;', k)
print('=== buildBrain tail ===')
print(h[k2-900:k2+200])
