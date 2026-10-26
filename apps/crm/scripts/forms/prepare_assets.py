"""Prepare the original fillable forms and stable UI geometry. Run only with source PDFs available.
Coordinates are top-left PDF points; signatures, initials and notarizations are never prefilled.
"""
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject, TextStringObject, ByteStringObject, DictionaryObject, ArrayObject
from PIL import Image
import json,re,hashlib,argparse
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/forms'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dealer-forms',required=True,help='Directory containing the eight original Drive Max PDFs')
parser.add_argument('--dmv-forms',required=True,help='Directory containing unmodified official NCDMV PDFs')
parser.add_argument('--mvr2',required=True,help='Original user-provided MVR-2 scan')
args=parser.parse_args()
SOURCE=Path(args.dealer_forms)
DMV_SOURCE=Path(args.dmv_forms)
MVR2_SOURCE=Path(args.mvr2)
ORDER=[('cover','Deal cover sheet','Drive_Max_Deal_Cover_Sheet.pdf'),('insurance','Insurance','Drive_Max_Agreement_to_Provide_Insurance.pdf'),('we-owe','We-owe / You-owe','Drive_Max_We_Owe_You_Owe.pdf'),('warranty','Limited powertrain warranty','Drive_Max_Limited_Powertrain_Warranty.pdf'),('references','References','Drive_Max_Personal_References.pdf'),('photo-release','Photo release','Drive_Max_Photo_Release.pdf'),('payoff','Trade-in payoff','Drive_Max_Retail_Lease_Payoff.pdf'),('bill-of-sale','Bill of sale','Drive_Max_Bill_of_Sale_Fillable.pdf')]
COMMON={
 'buyer_name':'buyer.name','customer_name':'buyer.name','buyer_phone':'buyer.phone','customer_phone':'buyer.phone','buyer_email':'buyer.email','customer_email':'buyer.email','buyer_address':'buyer.address','street_address':'buyer.address','buyer_city':'buyer.city','city':'buyer.city','buyer_state':'buyer.state','state':'buyer.state','buyer_zip':'buyer.zip','zip':'buyer.zip',
 'co_buyer_name':'co_buyer.name','cobuyer_name':'co_buyer.name','cobuyer_address':'co_buyer.address','cobuyer_city':'co_buyer.city','cobuyer_state':'co_buyer.state','cobuyer_zip':'co_buyer.zip','cobuyer_phone':'co_buyer.phone',
 'stock_number':'vehicle.stock_number','vehicle_year':'vehicle.year','vehicle_make':'vehicle.make','vehicle_model':'vehicle.model_trim','vehicle_vin':'vehicle.vin','vehicle_mileage':'vehicle.mileage','vehicle_color':'vehicle.color','vehicle_body':'vehicle.body','vehicle_condition':'vehicle.condition','sold_year':'vehicle.year','sold_make':'vehicle.make','sold_model':'vehicle.model_trim','sold_vin':'vehicle.vin','sold_mileage':'vehicle.mileage','sold_color':'vehicle.color','delivery_odometer':'vehicle.mileage',
 'trade_year':'trade.year','trade_make':'trade.make','trade_model':'trade.model_trim','trade_make_model':'trade.make_model','trade_vin':'trade.vin','trade_mileage':'trade.mileage','trade_stock_number':'trade.stock_number','trade_registered_owner':'trade.registered_owner','trade_lienholder':'trade.lienholder','trade_payoff':'deal.payoff','trade1_year':'trade.year','trade1_make_model':'trade.make_model','trade1_vin':'trade.vin','trade1_allowance':'deal.trade_allowance','trade1_payoff':'deal.payoff',
 'sale_date':'deal.date','deal_date':'deal.date','issue_date':'deal.date','delivery_date':'deal.delivery_date','delivery_time':'deal.delivery_time','deal_number':'deal.number','payment_method':'deal.payment_method','salesperson':'dealer.representative','salesperson_name':'dealer.representative','dealer_representative':'dealer.representative','dealer_representative_name':'dealer.representative',
 'insurance_company':'insurance.company','insurance_agent':'insurance.agent','insurance_phone':'insurance.phone','insurance_policy':'insurance.policy_number','policy_number':'insurance.policy_number','insurance_effective':'insurance.effective_from','insurance_expires':'insurance.effective_to','policy_effective_date':'insurance.effective_from','policy_expiration_date':'insurance.effective_to','comprehensive_deductible':'insurance.comprehensive_deductible','collision_deductible':'insurance.collision_deductible','agency_name':'insurance.agency','agent_name':'insurance.agent','agent_phone':'insurance.phone','agent_email':'insurance.email','agency_address':'insurance.agency_address','named_insured':'insurance.named_insured','vehicle_coverage_start':'insurance.vehicle_coverage_start','liability_limits':'insurance.liability_limits','lienholder_loss_payee':'lienholder.name',
 'subject_name':'buyer.name','subject_phone':'buyer.phone','subject_address':'buyer.full_address','adult_printed_name':'buyer.name',
 'deal_payoff_amount':'deal.payoff','lender_name':'trade.lienholder','account_number':'trade.account_number','payoff_address':'trade.payoff_address','payoff_quote_amount':'trade.payoff_quote_amount','daily_per_diem':'trade.daily_per_diem','payoff_good_through':'trade.payoff_good_through','payoff_valid_through':'trade.payoff_good_through','lender_representative':'trade.lender_representative','lender_phone':'trade.lender_phone',
 'vehicle_sales_price':'deal.price','accessories':'deal.add_ons','dealer_doc_fee':'deal.doc_fee','vehicle_taxable_subtotal':'deal.taxable_subtotal','total_trade_allowance':'deal.trade_allowance','vehicle_amount_after_trade':'deal.vehicle_after_trade','hut_taxable_base':'deal.taxable_base','highway_use_tax':'deal.tax','title_fee':'deal.title_fee','registration_fee':'deal.registration_fee','electronic_filing_fee':'deal.electronic_filing_fee','hut_title_other_fees':'deal.total_fees','trade_difference':'deal.trade_difference','net_trade_equity':'deal.net_trade_equity','service_contract':'deal.service_contract','gap':'deal.gap','prepaid_maintenance':'deal.prepaid_maintenance','tire_wheel':'deal.tire_wheel','optional_products_total':'deal.optional_products_total','net_sale_total':'deal.net_sale_total','total_trade_payoff':'deal.payoff','rebates':'deal.rebates','cash_deposit':'deal.cash_deposit','additional_cash_down':'deal.down_payment','deferred_down_credit':'deal.deferred_down','balance_due':'deal.balance','prepaid_finance_charges':'deal.prepaid_finance_charges','amount_financed':'deal.amount_financed','service_contract_provider':'service_contract.provider','service_contract_number':'service_contract.number',
 'plate_tag_number':'registration.plate_number','other_fee':'deal.other_taxes','notes_line_1':'notes.line1','notes_line_2':'notes.line2','notes_line_3':'notes.line3'
}
OFFICIAL={
'MVR-1':{
 'Enter Full Legal Name of Owner 1 to include First, Middle, Last, Suffix or Company 1 Name':'buyer.name',
 'Enter Full Legal Name of Owner 2 to include First, Middle, Last, Suffix or Company 2 Name':'co_buyer.name',
 'Enter Owner 1 ID Number':'buyer.license_number','Enter Owner 2 ID Number':'co_buyer.license_number',
 'Enter YEAR':'vehicle.year','Enter MAKE':'vehicle.make','Enter BODY STYLE':'vehicle.body','Enter SERIES MODEL':'vehicle.model_trim','Enter VEHICLE IDENTIFICATION NUMBER':'vehicle.vin','Enter FUEL TYPE':'vehicle.fuel','Enter ODOMETER READING':'vehicle.mileage',
 "Enter Street Address of Individual's Residence or Business/Firm to include apartment or suite numbers":'buyer.residence_address',"Enter City of Individual's Residence or Business/Firm":'buyer.residence_city',"Enter State of Individual's Residence or Business/Firm":'buyer.residence_state','Enter Individual Residence or Business/Firm Zip Code':'buyer.residence_zip',
 'Enter Mailing Street Address if different from above':'buyer.mailing_address','Enter Mailing City if different from above':'buyer.mailing_city','Enter Mailing State if different from above':'buyer.mailing_state','Enter Mailing Zip Code if different from above':'buyer.mailing_zip',
 'Enter Tax County':'buyer.county','Enter Date of 1st Lien':'lienholder.date','Enter First Lien Account Number':'lienholder.account','Enter First Lienholder ID Number':'lienholder.id','Enter 1st Lienholder Name':'lienholder.name','Enter 1st Lienholder Address to include Street and Apartment/Suite':'lienholder.address',"Enter 1st Lienholder's City":'lienholder.city',"Enter 1st Lienholder's State":'lienholder.state',"Enter 1st Lienholder's Zip Code":'lienholder.zip',
 'Enter Name of Insurance Company authorized in NC':'insurance.company','Enter Insurance Policy Number':'insurance.policy_number','Enter Purchase Date':'deal.date','Enter Name and Address From Whom you Purchased the Vehicle':'dealer.name_address','Enter NC Dealer Number if applicable':'dealer.number','Enter Plate Number Transferred':'registration.plate_number','Enter Class of License':'registration.class',
},
'MVR-63':{'Year':'vehicle.year','Make':'vehicle.make','Body Style':'vehicle.body','Series':'vehicle.model_trim','VIN':'vehicle.vin','BUYER,  SELLER, OR  LEGAL OWNER':'buyers.names','ATTORNEY':'dealer.representative'},
'MVR-180':{'YEAR':'vehicle.year','MAKE':'vehicle.make','BODY STYLE':'vehicle.body','SERIES MODEL':'vehicle.model_trim','VEHICLE IDENTIFICATION NUMBER':'vehicle.vin','sellers printed name':'dealer.name','SELLERS PRINTED NAME':'dealer.name','odometer now reads miles no tenths':'vehicle.mileage','BUYERS PRINTED NAME':'buyers.names','SELLERS street ADDRESS to include apartment or suite number':'dealer.address','sellers CITY':'dealer.city','sellers STATE':'dealer.state','sellers ZIP CODE':'dealer.zip','BUYERS street ADDRESS to include apartment or suite number':'buyer.address','buyers CITY':'buyer.city','buyers STATE':'buyer.state','buyers ZIP CODE':'buyer.zip'},
'MVR-181':{'Year':'vehicle.year','Make':'vehicle.make','Body Style':'vehicle.body','Vehicle Identification Number':'vehicle.vin','SELLERS ADDRESS to include street apartment or suite number city state zip':'dealer.full_address'},
'MVR-6TT':{'YEAR':'vehicle.year','MAKE BODY':'vehicle.make','MAKE BODYSTYLE':'vehicle.body','SERIES MODEL':'vehicle.model_trim','VEHICLE IDENTIFICATION NUMBER':'vehicle.vin','FUEL TYPE':'vehicle.fuel','Owner 1 ID':'buyer.license_number','Owner 2 ID':'co_buyer.license_number','Full Legal Name of Owner 1 First Middle Last Suffix or Company Name':'buyer.name','Full Legal Name of Owner 2 First Middle Last Suffix or Company Name':'co_buyer.name','Residence Address Individual Business Address Firm':'buyer.residence_address','Residential or Business City and State':'buyer.residence_city_state','Residential or Business Zip Code':'buyer.residence_zip','Residential or Business Tax County':'buyer.county','Mailing Address to include street apartment or suite number city state zip code if different from above':'buyer.full_mailing_address','Date of Lien Account':'lienholder.date','Lien Account Number':'lienholder.account','Lienholder Name':'lienholder.name','Lienholder ID':'lienholder.id','Address':'lienholder.address','City':'lienholder.city','State':'lienholder.state','Zip Code':'lienholder.zip','Dealer Number':'dealer.number',"Printed Dealer Representative's Name":'dealer.representative'}
}
SKIP_EXACT={
 'MVR-1':{'Enter Date','Enter State where Document is being Notarized','Enter County where Document is being Notarized'},
 'MVR-63':{'Date','County','State','Month'},
 'MVR-6TT':{'Date',"Date of dealer's certification",'County where application is being notarized','State where application is being notarized','Name(s) of principal(s)'},
 'bill-of-sale':{'buyer_sale_date','cobuyer_sale_date','dealer_sale_date'}
}
def skip(fid,name,ft):
 n=name.lower()
 return ft=='/Sig' or any(x in n for x in ['signature','initial','notary','notariz','commission expire','name of principals','name(s) of principal']) or name in SKIP_EXACT.get(fid,set())
def semantic(fid,name):
 if fid in OFFICIAL:return OFFICIAL[fid].get(name)
 if fid=='payoff' and name=='buyer_address':return 'buyer.full_address'
 if name in COMMON:return COMMON[name]
 if m:=re.fullmatch(r'reference_(\d+)_(.+)',name):return f'references.{int(m[1])-1}.{m[2]}'
 if m:=re.fullmatch(r'we_owe_(\d+)_(.+)',name):return f'we_owe.{int(m[1])-1}.{m[2]}'
 if m:=re.fullmatch(r'you_owe_(\d+)_(.+)',name):return f'you_owe.{int(m[1])-1}.{m[2]}'
 return None

def arr(obj):return obj.get_object() if hasattr(obj,'get_object') else obj

def repair_damage(w):
 # Source reuses one field for collision parts and recovered-theft parts; separate the latter.
 fields=w.root_object['/AcroForm']['/Fields']
 for aref in arr(w.pages[0].get('/Annots',[])):
  a=aref.get_object();p=a.get('/Parent');parent=p.get_object() if p else a
  if str(parent.get('/T',''))=='If yes list parts that were damaged' and float(a['/Rect'][1])<450:
   parent['/Kids'].remove(aref)
   n=DictionaryObject({NameObject('/FT'):NameObject('/Tx'),NameObject('/T'):TextStringObject('Recovered theft damaged parts'),NameObject('/TU'):TextStringObject('Recovered theft: damaged parts'),NameObject('/DA'):parent['/DA'],NameObject('/V'):TextStringObject(''),NameObject('/Kids'):ArrayObject([aref])})
   nr=w._add_object(n);fields.append(nr);a[NameObject('/Parent')]=nr

def normalize_field_layout(w,fid):
 # Several official widgets specify 12pt text inside an 11pt-high rectangle.
 # Use native auto-sizing there; retain every printed line and widget position.
 for page in w.pages:
  for ar in arr(page.get('/Annots',[])):
   a=ar.get_object();p=a.get('/Parent');f=p.get_object() if p else a
   if f.get('/FT',a.get('/FT'))!='/Tx':continue
   da=str(f.get('/DA',a.get('/DA','')));m=re.search(r'([0-9.]+)\s+Tf',da)
   height=float(a['/Rect'][3])-float(a['/Rect'][1])
   if m and float(m[1])>min(10,height*.8):
    f[NameObject('/DA')]=TextStringObject(da[:m.start(1)]+'0'+da[m.end(1):])
   if fid=='MVR-1' and str(f.get('/T',''))=='Enter Name and Address From Whom you Purchased the Vehicle':
    f[NameObject('/Ff')]=NumberObject(int(f.get('/Ff',0))|4096)

def normalize_appearance_encoding(w):
 # pdf-lib reads literal /DA strings without decoding octal slash escapes.
 # Hex PDF strings preserve the same bytes and decode consistently in both tools.
 for obj in w._objects:
  if isinstance(obj,DictionaryObject) and '/DA' in obj:
   da=obj['/DA']
   if isinstance(da,str):obj[NameObject('/DA')]=ByteStringObject(da.encode('ascii'))

def manifest_form(fid,title,file,source):
 r=PdfReader(OUT/file);pages=[];excluded=[]
 fields=r.get_fields() or {}
 for i,p in enumerate(r.pages):
  W,H=float(p.mediabox.width),float(p.mediabox.height);ds=[]
  for wi,ar in enumerate(arr(p.get('/Annots',[]))):
   a=ar.get_object()
   if a.get('/Subtype')!='/Widget':continue
   parent=a.get('/Parent');f=parent.get_object() if parent else a;name=str(f.get('/T',a.get('/T','')));ft=f.get('/FT',a.get('/FT'));ff=int(f.get('/Ff',a.get('/Ff',0)))
   if skip(fid,name,ft):excluded.append(name);continue
   if ft not in ['/Tx','/Btn','/Ch']:continue
   x1,y1,x2,y2=map(float,a['/Rect']);da=str(f.get('/DA',a.get('/DA','')));m=re.search(r'([0-9.]+)\s+Tf',da);font=float(m[1]) if m else 0
   d={'name':name,'label':str(f.get('/TU') or name.replace('_',' ')),'type':'checkbox' if ft=='/Btn' else 'text','x':round(x1,3),'y':round(H-y2,3),'width':round(x2-x1,3),'height':round(y2-y1,3),'fontSize':min(font or 10,max(6,(y2-y1)*.72))}
   key=semantic(fid,name)
   if key and ft!='/Btn':d['key']=key
   if ff & 4096:d['multiline']=True
   if ft=='/Ch':d['options']=[str(v) for v in f.get('/Opt',[])]
   if ft=='/Btn':
    states=list(a.get('/AP',{}).get('/N',{}).keys());export=next((str(x).lstrip('/') for x in states if x!='/Off'),'Yes');d['exportValue']=export
    if ff & 32768:d['radioGroup']=name;d['label']=export
   if '/V' in f and str(f['/V']) not in ['','/Off']:d['defaultValue']=str(f['/V']).lstrip('/') if ft=='/Btn' else str(f['/V'])
   ds.append(d)
  pages.append({'width':W,'height':H,'fields':ds})
 return {'id':fid,'title':title,'file':file,'source':source,'pages':pages,'excludedFields':sorted(set(excluded))}

OUT.mkdir(parents=True,exist_ok=True);forms=[]
for fid,title,name in ORDER:
 src=SOURCE/name;r=PdfReader(src);w=PdfWriter();w.clone_document_from_reader(r)
 for p in w.pages:
  for im in p.images:
   if im.image.width>1000:
    image=im.image.copy();image.thumbnail((1000,1000),Image.Resampling.LANCZOS)
    if image.mode=='RGBA':bg=Image.new('RGB',image.size,'white');bg.paste(image,mask=image.getchannel('A'));image=bg
    im.replace(image.convert('RGB'),quality=95)
  p.compress_content_streams()
 # Keep each widget's blank appearance stream independent. Deduplicating those
 # streams can make later native form fills display another field's text.
 normalize_appearance_encoding(w)
 w.write(OUT/name)
 forms.append(manifest_form(fid,title,name,{'kind':'Drive Max original','originalName':name,'sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'revision':'10/2026C' if fid=='bill-of-sale' else '10/2026'}))
for fid,title in [('MVR-1','MVR-1 · Title application'),('MVR-63','MVR-63 · Power of attorney'),('MVR-180','MVR-180 · Odometer disclosure'),('MVR-181','MVR-181 · Damage disclosure'),('MVR-6TT','MVR-6TT · Title in transit')]:
 p=OUT/(fid+'.pdf');src=DMV_SOURCE/(fid+'.pdf');original=src.read_bytes();r=PdfReader(src);w=PdfWriter();w.clone_document_from_reader(r)
 if fid=='MVR-181':repair_damage(w)
 normalize_field_layout(w,fid)
 for page in w.pages:page.compress_content_streams()
 normalize_appearance_encoding(w)
 w.write(p)
 forms.append(manifest_form(fid,title,p.name,{'kind':'NCDMV','url':'https://www.ncdot.gov/dmv/downloads/Documents/'+p.name,'retrievedOn':'2026-10-26','revision':'04/2026','sha256':hashlib.sha256(original).hexdigest()}))

# The MVR-2 scan is an upright PREVIEW only. Do not print this page on preprinted stock.
r=PdfReader(MVR2_SOURCE);w=PdfWriter();w.clone_document_from_reader(r);p=w.pages[0];p[NameObject('/Rotate')]=NumberObject(0)
w.write(OUT/'MVR-2-preview.pdf')
# Map only typed data / selectable disclosures. No signature, initials or notary widgets.
mfields=[]
def mf(name,label,x,y,width,height=10,typ='text',key=None,section=None,group=None):
 d={'name':name,'label':label,'type':typ,'x':x,'y':y,'width':width,'height':height,'fontSize':8}
 if key:d['key']=key
 if section:d['section']=section
 if group:d['exclusiveGroup']=group
 mfields.append(d)
for name,label,x,width in [('year','Year',64,50),('make','Make',145,78),('body','Body style',287,77),('vin','VIN',385,163)]:mf('vehicle.'+name,label,x,94,width,key='vehicle.'+name)
for n,dy in [(1,0),(2,208.5),(3,417.5)]:
 pre=f'section{n}.'
 mf(pre+'buyer_name_address','Buyer name and mailing address',38,153+dy,539,11,key=pre+'buyer_name_address',section=n)
 mf(pre+'mileage','Odometer reading',264,167.5+dy,131,9,key=pre+'mileage',section=n)
 mf(pre+'delivered_on','Date delivered to purchaser',39,196.5+dy,109,9,key=pre+'delivered_on',section=n)
 mf(pre+'mileage_exceeds','Mileage exceeds mechanical limits',37,188.7+dy,6,6,'checkbox',section=n,group=pre+'odometer')
 mf(pre+'mileage_not_actual','Mileage is not actual',260,188.7+dy,6,6,'checkbox',section=n,group=pre+'odometer')
 for label,row in [('damage',209.0),('flood_reconstructed_salvage',218.5)]:
  for answer,x in [('yes',172),('no',198.5)]:mf(pre+label+'_'+answer,label.replace('_',' ').capitalize()+' · '+answer.capitalize(),x,row+dy,6,6,'checkbox',section=n,group=pre+label)
 mf(pre+'dealer_name','Printed dealer firm name',108,242+dy,342,9,key=pre+'dealer_name',section=n)
 mf(pre+'dealer_number','Dealer number',491,242+dy,86,9,key=pre+'dealer_number',section=n)
mvr2={'id':'MVR-2','title':'MVR-2 · Preprinted dealer reassignment','file':'MVR-2-preview.pdf','previewOnly':True,'source':{'kind':'User supplied scan','revision':'01/2017','originalRotation':270,'normalizedRotation':0},'pages':[{'width':612,'height':792,'fields':mfields}],'excludedFields':['All signatures','All initials','All notarizations'],'printMode':'text-only','calibration':{'x':0,'y':0,'scale':1},'instructions':'Print at Actual size / 100%. Use a plain-paper alignment test against your original form before printing on preprinted stock. Select exactly one reassignment section; other sections must remain blank.'}
manifest={'version':1,'units':'pt','origin':'top-left','preparedOn':'2026-10-26','forms':forms,'mvr2':mvr2}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'forms':len(forms),'fields':sum(len(p['fields']) for f in forms for p in f['pages']),'mvr2Fields':len(mfields),'totalBytes':sum(p.stat().st_size for p in OUT.glob('*.pdf'))}))
