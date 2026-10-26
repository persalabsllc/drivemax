'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {X,ArrowUpRight,Inbox} from 'lucide-react';
export function Avatar({name,size='normal'}:{name:string;size?:'normal'|'large'|'small'}){const n=name.split(' ').map(x=>x[0]).slice(0,2).join('');const tone=name.charCodeAt(0)%5;return <span className={`avatar ${size} tone-${tone}`}>{n}</span>;}
export function Badge({value}:{value:string}){return <span className={`badge badge-${value.replaceAll(' ','-')}`}>{value.replaceAll('_',' ')}</span>;}
export function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close();},[]);return <dialog ref={ref} className={`modal ${wide?'wide':''}`} aria-label={title} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}}><header className="modal-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></header>{children}</dialog>;}
export function Empty({title,body,action}:{title:string;body:string;action?:ReactNode}){return <div className="empty"><span><Inbox size={26}/></span><h3>{title}</h3><p>{body}</p>{action}</div>;}
export function SectionTitle({title,subtitle,action}:{title:string;subtitle?:string;action?:ReactNode}){return <div className="section-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>;}
export function Go({children,onClick}:{children:ReactNode;onClick:()=>void}){return <button className="text-btn" onClick={onClick}>{children}<ArrowUpRight size={15}/></button>;}
