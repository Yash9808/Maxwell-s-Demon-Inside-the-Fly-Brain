import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
idx = 0
while True:
    i = h.find('__brainDebug', idx)
    if i == -1: break
    print('=== at', i, '===')
    print(h[max(0,i-350):i+500].replace('\r','').replace('\n',' | ')[:850])
    print()
    idx = i + 1
