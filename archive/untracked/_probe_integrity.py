import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
i = h.find('anatomical mapping')
count = 0
while i != -1 and count < 6:
    seg = h[max(0,i-500):i+400]
    if 'textContent' in seg or 'innerHTML' in seg or 'unmapped' in seg:
        print('=== integrity writer at', i, '===')
        print(seg.replace('\r','').replace('\n',' | ')[:900])
        print()
        count += 1
    i = h.find('anatomical mapping', i+1)
# inactive tint code (the faint grey/blue idle neurons in the LC panel + 3D)
j = h.find('"#6f7a88"')
print('=== LC base-cloud fill (idle tint) ===')
print(h[j-200:j+300].replace('\r','').replace('\n',' | ')[:600])
