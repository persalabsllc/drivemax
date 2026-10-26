import CRM from '../../components/CRM';
import {demoWorkspace} from '../../lib/demo';
export const dynamic='force-dynamic';
export default function Demo(){return <CRM initial={demoWorkspace()} demo/>;}
