# Replace the icon (RT_ICON + RT_GROUP_ICON) inside a Windows .exe in place, and set version strings.
import struct, sys
def u16(b,o): return struct.unpack_from('<H',b,o)[0]
def u32(b,o): return struct.unpack_from('<I',b,o)[0]
def sections(b):
    pe=u32(b,0x3c); assert b[pe:pe+4]==b'PE\0\0'
    nsec=u16(b,pe+6); optsz=u16(b,pe+20); opt=pe+24; magic=u16(b,opt)
    ddir=opt+(112 if magic==0x20b else 96)
    rsrc_rva=u32(b,ddir+2*8)
    secs=[]; st=opt+optsz
    for i in range(nsec):
        o=st+i*40; name=b[o:o+8].rstrip(b'\0'); vsz,va,rsz,rptr=struct.unpack_from('<IIII',b,o+8); secs.append((name,va,vsz,rptr,rsz))
    return rsrc_rva,secs,pe
def rva2off(secs,rva):
    for n,va,vsz,rp,rs in secs:
        if va<=rva<va+max(vsz,rs): return rva-va+rp
    raise ValueError(rva)
def walk(b,base,off,depth,path,out):
    named=u16(b,off+12); ids=u16(b,off+14)
    for i in range(named+ids):
        e=off+16+i*8; nid=u32(b,e); ptr=u32(b,e+4)
        key=nid if not nid&0x80000000 else ('name',nid&0x7fffffff)
        if ptr&0x80000000: walk(b,base,base+(ptr&0x7fffffff),depth+1,path+[key],out)
        else: out.append((path+[key],base+ptr))
def main(exe,ico,outp):
    b=bytearray(open(exe,'rb').read()); rr,secs,pe=sections(b); base=rva2off(secs,rr)
    leaves=[]; walk(b,base,base,0,[],leaves)
    icons={p[1]:de for p,de in leaves if p[0]==3}
    groups=[(p,de) for p,de in leaves if p[0]==14]
    # parse new .ico
    I=open(ico,'rb').read(); n=u16(I,4); imgs=[]
    for i in range(n):
        o=6+i*16; w,h,cc,res,planes,bpp,size,offs=struct.unpack_from('<BBBBHHII',I,o); imgs.append(dict(w=w,h=h,cc=cc,planes=planes,bpp=bpp,data=I[offs:offs+size]))
    # existing group
    gp,gde=groups[0]; goff=rva2off(secs,u32(b,gde)); gsz=u32(b,gde+4); cnt=u16(b,goff+4)
    old=[]
    for i in range(cnt):
        o=goff+6+i*14; w,h,cc,res,planes,bpp,size,rid=struct.unpack_from('<BBBBHHIH',b,o); old.append(dict(w=w or 256,rid=rid,size=size))
    # pair each old slot with the new image of the same size (fall back to the closest smaller one that fits)
    used=[]
    for slot in old:
        de=icons[slot['rid']]; cap=u32(b,de+4); doff=rva2off(secs,u32(b,de))
        cands=sorted(imgs,key=lambda im:abs((im['w'] or 256)-slot['w']))
        pick=next((im for im in cands if len(im['data'])<=cap),None)
        if not pick: print('skip slot',slot['w'],'cap',cap); continue
        b[doff:doff+cap]=pick['data']+b'\0'*(cap-len(pick['data']))
        struct.pack_into('<I',b,de+4,len(pick['data']))
        slot['new']=pick; used.append((slot['w'],pick['w'] or 256,len(pick['data']),cap))
    for i,slot in enumerate(old):
        if 'new' not in slot: continue
        im=slot['new']; o=goff+6+i*14
        struct.pack_into('<BBBBHHIH',b,o,im['w'],im['h'],im['cc'],0,im['planes'] or 1,im['bpp'] or 32,len(im['data']),slot['rid'])
    # clear the PE checksum (not required for normal programs)
    opt=pe+24; struct.pack_into('<I',b,opt+64,0)
    open(outp,'wb').write(b); print('replaced',used)
if __name__=='__main__': main(*sys.argv[1:4])
