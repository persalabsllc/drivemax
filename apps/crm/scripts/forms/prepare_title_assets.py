"""Prepare additional NCDMV title-work forms from the reviewed official originals.

Usage: python scripts/forms/prepare_title_assets.py --source /path/to/originals
Keeps printed content and widget positions; deliberately rebuilds canonical fields
per widget to repair shared names, incomplete parents and broken source field trees.
Signatures, initials, execution dates and notarial sections are never editable.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ByteStringObject, NameObject, NumberObject, TextStringObject

OUT = Path(__file__).resolve().parents[2] / 'assets/forms'
# Ordinals identify the reviewed source widgets in page order, including protected
# widgets. Pinned source hashes prevent a changed DMV layout from shifting mappings.
SPECS = {
 'MVR-614': ('Non-resident title affidavit', 'eae3f464136b330b151230f7e81fd3f28c0e4c1355c6bfa2d65300783ef99e67', list(range(17,26))),
 'MVR-330': ('Registration / plate transfer for leased vehicles', '60efe2b21c5b318b6a183ed3bde305da7e7cfe9657f1199366143eabf537f84c', [22,23,32]),
 'MVR-1A': ('Plate and address certification', 'd6525492ddbe3f5a58fa69fea6bfe4c7663166262da46392c84f00482737d4ac', [13,38,39,40]),
 'MVR-4': ('Duplicate title application', '3d20c2694c0f9f083ed1e2b17010a28eeed69d723a3ab6f5d36be99ab5791d72', list(range(32,40))+list(range(45,53))),
 'MVR-5': ('Corrected / substitute title application', '1d5c44b93ebace686591f29a1ed31146cfe62c19b3f8a8c6fb80cf1b84ba6377', list(range(56,65))+list(range(69,76))),
 'MVR-6': ('Lien recording application', 'd46f4d6cb0fbf00ee97acbb3e7be50aa7da37200894ba45aef93b658ddee6600', list(range(53,61))),
 'MVR-8': ('Lien removal application', '35b1a3eb83737ecc0778ddc21de0efd7b678af0b95a3d779f775e038ab780633', [14,15,16,18,19,20,21,28]),
 'MVR-28': ('Incorrect title assignment affidavit', '7af18cd4f1f187e4375ec4deb3b903fe96947e3b664e198a2c54914f7872a8d9', list(range(15,24))+list(range(26,35))+list(range(39,49))),
 'MVR-46D': ('North Carolina lienholder release', 'd90e522a0a76d81c6e518ba242a68fc939151433ee2fce8a5dbeeaa01bebf002', list(range(9,17))),
 'MVR-613': ('Highway-use tax exemption certification', '3fb7f912002ea25783751e338454a96a7ef81077235a7b409fac98890725e8b9', [26]+list(range(28,35))),
 'MVR-620': ('Joint tenancy with right of survivorship', '626fb34d9468451e76885c20b4b5671508d3fef44b48f45aca9ec8e9b00a46c4', list(range(19,28))),
}
KEYS = {
 'MVR-614': {1:'vehicle.year',2:'vehicle.make',3:'vehicle.model_trim',4:'vehicle.vin',9:'buyer.name',10:'buyer.license_id',11:'buyer.license_state'},
 'MVR-330': {1:'vehicle.year',2:'vehicle.make',3:'vehicle.body',4:'vehicle.model_trim',5:'vehicle.vin',6:'vehicle.fuel',7:'vehicle.mileage'},
 'MVR-1A': {14:'vehicle.year',15:'vehicle.make',16:'vehicle.body',17:'vehicle.model_trim',18:'vehicle.vin',19:'vehicle.fuel',20:'vehicle.mileage',21:'buyer.license_number',22:'buyer.name',23:'co_buyer.license_number',24:'co_buyer.name',25:'buyer.address',26:'buyer.city',27:'buyer.state',28:'buyer.zip',29:'buyer.mailing_address',30:'buyer.mailing_city',31:'buyer.mailing_state',32:'buyer.mailing_zip',37:'buyer.county'},
 'MVR-4': {2:'vehicle.year',3:'vehicle.make',4:'vehicle.body',5:'vehicle.model_trim',6:'vehicle.vin',7:'vehicle.fuel',31:'vehicle.mileage'},
 'MVR-5': {1:'vehicle.year',2:'vehicle.make',3:'vehicle.body',4:'vehicle.model_trim',6:'vehicle.vin',7:'vehicle.fuel',8:'vehicle.mileage'},
 'MVR-6': {2:'vehicle.year',3:'vehicle.make',4:'vehicle.body',5:'vehicle.model_trim',6:'vehicle.vin'},
 'MVR-8': {1:'vehicle.year',2:'vehicle.make',3:'vehicle.body',4:'vehicle.model_trim',5:'vehicle.vin'},
 'MVR-46D': {3:'vehicle.year',4:'vehicle.make',5:'vehicle.body',6:'vehicle.vin'},
 'MVR-613': {1:'vehicle.year',2:'vehicle.make',3:'vehicle.body',4:'vehicle.vin',5:'vehicle.fuel',6:'buyers.names',27:'buyer.full_address'},
 'MVR-620': {1:'vehicle.year',2:'vehicle.make',3:'vehicle.body',4:'vehicle.model_trim',5:'vehicle.vin',6:'buyer.license_number',7:'buyer.name',8:'co_buyer.license_number',9:'co_buyer.name',12:'buyer.address',13:'buyer.residence_city_state',14:'buyer.zip',15:'buyer.mailing_address',16:'buyer.mailing_city_state',17:'buyer.mailing_zip'},
}
LABELS = {
 'MVR-614': {12:'Military ID number'},
 'MVR-330': {25:'Limited registration plate: Yes',26:'Limited registration plate: No',29:'For hire: Yes',30:'For hire: No'},
 'MVR-5': {6:'Vehicle identification number',13:'Full legal name of Owner 2',14:'Joint tenants with right of survivorship: Yes',15:'Joint tenants with right of survivorship: No',20:'Mailing address',22:'Insurance company',27:'First lienholder ID number',29:'First lienholder address',36:'Second lienholder ID number',38:'Second lienholder address',47:'Wrong lienholder',53:'Detailed explanation, line 3',54:'Detailed explanation, line 2',55:'Detailed explanation, line 1'},
 'MVR-6': {7:'Owner 1 ID number',52:'Make personal information available for marketing and solicitation disclosure'},
 'MVR-28': {9:'Title number assigned to purchaser, if known'},
 'MVR-46D': {2:'Name on existing title'},
 'MVR-613': {21:'Partial credits pursuant to G.S. 105-187.7'},
}
EXCLUSIVE = {'MVR-330': [[25,26],[29,30]], 'MVR-1A': [[11,12]], 'MVR-620': [[10,11]], 'MVR-5': [[14,15]], 'MVR-4': [[26,27,28]]}

def obj(value):
    return value.get_object() if hasattr(value, 'get_object') else value

def prepare(source: Path):
    forms = []
    for fid, (title, digest, excluded) in SPECS.items():
        original = (source / (fid+'.pdf')).read_bytes()
        if hashlib.sha256(original).hexdigest() != digest:
            raise ValueError(f'{fid}: source changed; review the new layout before updating mappings')
        writer = PdfWriter()
        writer.clone_document_from_reader(PdfReader(source / (fid+'.pdf')))
        root_fields, pages, protected, ordinal = ArrayObject(), [], [], 0
        for page in writer.pages:
            height, width = float(page.mediabox.height), float(page.mediabox.width)
            fields = []
            for ref in obj(page.get('/Annots', [])):
                widget = obj(ref)
                if widget.get('/Subtype') != '/Widget':
                    continue
                ordinal += 1
                chain, cursor, seen = [], widget, set()
                while cursor is not None and id(cursor) not in seen:
                    seen.add(id(cursor)); chain.append(cursor)
                    cursor = obj(cursor['/Parent']) if '/Parent' in cursor else None
                native = next((str(v['/T']) for v in chain if '/T' in v), '')
                label = LABELS.get(fid, {}).get(ordinal) or next((str(v['/TU']) for v in chain if v.get('/TU')), native)
                for key in ['/FT','/Ff','/DA','/V','/DV','/Opt']:
                    inherited = next((v[key] for v in chain if key in v), None)
                    if inherited is not None:
                        widget[NameObject(key)] = inherited
                for key in ['/Parent','/Kids','/AA','/A','/MaxLen']:
                    widget.pop(key, None)
                name = f'F{ordinal:03}'
                widget[NameObject('/T')] = TextStringObject(name)
                widget[NameObject('/TU')] = TextStringObject(label)
                if fid == 'MVR-28' and ordinal == 9:
                    widget[NameObject('/FT')] = NameObject('/Tx')
                    widget[NameObject('/DA')] = TextStringObject('/Helv 0 Tf 0 g')
                ft, flags = str(widget.get('/FT')), int(widget.get('/Ff',0))
                # Distinct widgets become independent canonical fields. Radio pairs
                # retain exclusivity in the manifest/UI without ambiguous parents.
                if ft == '/Btn':
                    flags &= ~(32768 | 16384)
                    widget[NameObject('/V')] = NameObject('/Off')
                    widget[NameObject('/AS')] = NameObject('/Off')
                else:
                    widget[NameObject('/V')] = TextStringObject('')
                widget.pop('/DV', None)
                widget[NameObject('/Ff')] = NumberObject(flags & ~1)
                x1,y1,x2,y2 = map(float, widget['/Rect'])
                da = widget.get('/DA', '/Helv 0 Tf 0 g')
                da = bytes(da).decode('ascii') if isinstance(da, bytes) else str(da)
                if ft == '/Tx':
                    da = re.sub(r'[0-9.]+\s+Tf', '0 Tf', da)
                    widget[NameObject('/DA')] = ByteStringObject(da.encode('ascii'))
                root_fields.append(ref)
                if ordinal in excluded or ft == '/Sig':
                    protected.append({'name':name,'originalName':native})
                    continue
                checkbox = ft == '/Btn' or (fid == 'MVR-6' and ordinal == 52)
                field = {'name':name,'originalName':native,'label':label,'type':'checkbox' if checkbox else 'text','x':round(x1,3),'y':round(height-y2,3),'width':round(x2-x1,3),'height':round(y2-y1,3),'fontSize':min(10,max(5,(y2-y1)*.72))}
                if key := KEYS.get(fid,{}).get(ordinal): field['key'] = key
                if flags & 4096: field['multiline'] = True
                for gi, group in enumerate(EXCLUSIVE.get(fid,[])):
                    if ordinal in group: field['exclusiveGroup'] = f'choice-{gi}'
                if fid == 'MVR-6' and ordinal == 52: field['textCheckbox'] = True
                fields.append(field)
            page.compress_content_streams()
            pages.append({'width':width,'height':height,'fields':fields})
        acroform = writer.root_object['/AcroForm']
        acroform[NameObject('/Fields')] = root_fields
        acroform.pop('/XFA',None); acroform.pop('/CO',None)
        for item in writer._objects:
            if hasattr(item,'keys') and '/DA' in item and isinstance(item['/DA'],str):
                item[NameObject('/DA')] = ByteStringObject(item['/DA'].encode('ascii'))
        # Never deduplicate appearance streams: later independent fills need them.
        output = OUT / (fid+'.pdf')
        writer.write(output)
        check = PdfReader(output)
        assert len(check.get_fields()) == ordinal, (fid, 'canonical field count')
        assert len(check.pages) == len(pages)
        forms.append({'id':fid,'title':fid+' · '+title,'file':output.name,'pages':pages,'excludedFields':protected,'source':{'kind':'NCDMV','url':'https://www.ncdot.gov/dmv/downloads/Documents/'+output.name,'retrievedOn':'2026-10-27','revision':'08/2018' if fid == 'MVR-5' else '04/2026','sha256':digest}})
        print(f'{fid}: {len(pages)} page(s), {ordinal} canonical fields, {sum(len(p["fields"]) for p in pages)} editable')
    (OUT/'title-forms.json').write_text(json.dumps({'forms':forms},indent=2)+'\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    prepare(parser.parse_args().source)
