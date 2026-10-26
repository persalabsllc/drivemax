import {redirect} from 'next/navigation';
import {session,workspace} from '../lib/server';
import CRM from '../components/CRM';
export const dynamic='force-dynamic';
export default async function Home(){const s=await session();if(!s)redirect('/login');return <CRM initial={await workspace(s)} demo={false}/>;}
