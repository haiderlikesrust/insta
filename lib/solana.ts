import {createHash} from 'node:crypto';
export {TOKEN_PROGRAM_ID as TOKEN_PROGRAM, NATIVE_MINT} from '@solana/spl-token';
export const discriminator=(name:string)=>createHash('sha256').update(`global:${name}`).digest().subarray(0,8);
