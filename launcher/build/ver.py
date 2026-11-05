# Writes a new VS_VERSIONINFO into free space left in the icon area, and points the version resource at it.
import struct, sys
sys.path.insert(0, '.'); import icon as T
def pad4(b): return b + b'\0' * ((4 - len(b) % 4) % 4)
def node(key, value=b'', vlen=0, typ=1, children=b''):
    k = (key + '\0').encode('utf-16-le')
    head = struct.pack('<HHH', 0, vlen, typ) + k
    head = pad4(head)
    body = head + value
    body = pad4(body) if children else body
    body += children
    return struct.pack('<H', len(body)) + body[2:]
def strnode(key, val):
    v = (val + '\0').encode('utf-16-le')
    return pad4(node(key, v, len(val) + 1, 1))
def build(ver, strings):
    a, b2, c, d = (list(map(int, ver.split('.'))) + [0, 0, 0, 0])[:4]
    ffi = struct.pack('<IIIIIIIIIIIII', 0xFEEF04BD, 0x00010000, (a << 16) | b2, (c << 16) | d, (a << 16) | b2, (c << 16) | d, 0x3F, 0, 0x40004, 1, 0, 0, 0)
    st = b''.join(strnode(k, v) for k, v in strings)
    table = pad4(node('040904b0', b'', 0, 1, st))
    sfi = pad4(node('StringFileInfo', b'', 0, 1, table))
    var = pad4(node('Translation', struct.pack('<HH', 0x0409, 0x04b0), 4, 0))
    vfi = pad4(node('VarFileInfo', b'', 0, 1, var))
    return node('VS_VERSION_INFO', ffi, len(ffi), 0, sfi + vfi)
def main(exe, out, ver, name, orig):
    o0 = open(orig, 'rb').read(); r0, s0, p0 = T.sections(o0); b0 = T.rva2off(s0, r0); L0 = []; T.walk(o0, b0, b0, 0, [], L0)
    origsize = {p[1]: T.u32(o0, de + 4) for p, de in L0 if p[0] == 3}
    b = bytearray(open(exe, 'rb').read()); rr, secs, pe = T.sections(b); base = T.rva2off(secs, rr); L = []; T.walk(b, base, base, 0, [], L)
    vde = [de for p, de in L if p[0] == 16][0]
    icons = [(T.u32(b, de), T.u32(b, de + 4), origsize[p[1]]) for p, de in L if p[0] == 3]
    blob = build(ver, [('CompanyName', 'Lucien family'), ('FileDescription', name), ('FileVersion', ver), ('InternalName', name),
                       ('LegalCopyright', 'Lucien family. Built on Electron (MIT).'), ('OriginalFilename', name + '.exe'), ('ProductName', name), ('ProductVersion', ver)])
    for rva, size, cap in icons:
        start = (rva + size + 7) & ~7
        if rva + cap - start >= len(blob):
            off = T.rva2off(secs, start); b[off:off + len(blob)] = blob
            struct.pack_into('<II', b, vde, start, len(blob)); open(out, 'wb').write(b); print('version info placed', len(blob), 'bytes'); return
    raise SystemExit('no room for version info')
if __name__ == '__main__': main(*sys.argv[1:6])
