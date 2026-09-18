import { parseAnswerKey } from "../src/answerKey";

const mk = (text: string, pn: number) => ({ pageNumber: pn, text });
const keyLines = [{ ...mk("321 C 322 A\n323 B 324 D\n325 A 326 B", 1) }];
console.log("keys-only, tq=0:", parseAnswerKey(keyLines as never, 0).entries.length);
console.log("keys-only, tq=6:", parseAnswerKey(keyLines as never, 6).entries.length);
