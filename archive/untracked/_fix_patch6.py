import re
src = open('_patch_3d6.py', 'rb').read()
# any non-ascii byte inside the file's byte literals -> \uXXXX escape of the decoded char
text = src.decode('utf-8', 'replace')
def esc(m):
    ch = m.group(0)
    return '\\u%04x' % ord(ch)
fixed = re.sub(r'[^\x00-\x7f]', esc, text)
open('_patch_3d6.py', 'wb').write(fixed.encode('ascii'))
print('fixed; remaining non-ascii:', sum(1 for b in fixed.encode('ascii') if b > 127))
