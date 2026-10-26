'use server';
import {redirect} from 'next/navigation';
import {auth,ready,session} from '../../lib/server';
export async function signIn(_: {error:string},form:FormData){
 if(!ready())return {error:'Your live workspace is being connected. The demo is available below.'};
 const email=String(form.get('email')||'').trim(),password=String(form.get('password')||'');
 if(!email||!password)return {error:'Enter your email address and password.'};
 try{const a=await auth();const {error}=await a.auth.signInWithPassword({email,password});if(error)return {error:'Unable to sign in. Check your email and password.'};if(!await session()){await a.auth.signOut({scope:'local'});return {error:'This account does not have CRM access yet.'};}}catch{return {error:'Sign-in is temporarily unavailable. Please try again.'};}
 redirect('/');
}
export async function signOut(){if(ready())await (await auth()).auth.signOut({scope:'local'});redirect('/login');}
