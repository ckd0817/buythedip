"""Optional font maintenance: requires fontTools + brotli and the upstream OFL OTF in output/share-fonts."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont,woff2
original=woff2.brotli.compress
def fast(data,**kwargs):
 kwargs['quality']=5
 return original(data,**kwargs)
woff2.brotli.compress=fast
for start in range(0x3400,0xa000,0x400):
 font=TTFont('output/share-fonts/SourceHanSerifSC-Heavy.otf')
 options=subset.Options(); options.hinting=False
 sub=subset.Subsetter(options=options); sub.populate(unicodes=range(start,min(start+0x400,0xa000))); sub.subset(font)
 for name in font['name'].names:
  if name.nameID in (1,3,4,6,16): name.string='DipShareSerifHeavy'.encode(name.getEncoding(),errors='replace')
 font.flavor='woff2'; font.save(f'public/fonts/share-serif-{start:x}.woff2')
print('Font chunks ready')
