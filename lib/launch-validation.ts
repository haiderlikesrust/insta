import {devBuySchema} from './sol-amount';
type Fields={name:string;symbol:string;handle?:string;image:string;website:string;twitter:string;telegram:string;devBuySol:string};
export function formProblem(form:Fields,launch=false,creator?:{checked:boolean;consent:boolean}){
 if(!form.name.trim())return 'Enter a coin name.';
 if(new TextEncoder().encode(form.name.trim()).length>32)return 'Coin name must fit in 32 UTF-8 bytes.';
 if(!/^[A-Z0-9]{1,10}$/.test(form.symbol))return 'Enter a ticker using 1–10 letters or numbers.';
 if(form.handle!==undefined&&!/^[a-z0-9._]{1,30}$/i.test(form.handle.trim().replace(/^@/,'')))return 'Enter a valid Instagram username.';
 if(launch&&!form.image)return 'Upload a coin image before launching.';
 for(const [key,label] of [['website','Website'],['twitter','X'],['telegram','Telegram']] as const){
  const value=form[key];if(!value)continue;try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||value.length>200)throw new Error();}catch{return `${label} must be a valid HTTPS link, or leave it blank.`;}
 }
 if(!devBuySchema.safeParse(form.devBuySol).success)return 'Enter a valid dev buy in SOL, with up to 9 decimal places. Leave blank to skip.';
 if(launch&&creator&&!creator.checked)return 'Click “Check Instagram account” and wait for the account to be found before launching.';
 if(launch&&creator&&!creator.consent)return 'Confirm that you understand a launch does not imply the creator’s endorsement.';
 return null;
}
