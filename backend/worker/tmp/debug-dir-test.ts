import { parseFullTest } from "../src/fullTestParser";
import { normalizeText } from "../src/textNormalize";

const pages = normalizeText([
  {
    pageNumber: 20,
    text: "# Question 4\n\n**Student-produced response directions**\n\n* If you find **more than one correct answer**, enter only one answer.\n* You can enter up to 5 characters for a **positive** answer.\n\n$YVAL$ = -0.5\n\n# Question 5\n\nWhich expression is equivalent?\nA. One\nB. Two".replace("YVAL", "y"),
  },
]);
const r = parseFullTest(pages as never, { contentScope: "full_test" });
console.log(r.questions.length);
for (const q of r.questions) console.log("#" + q.sourceQuestionNumber, JSON.stringify(q.prompt.slice(0, 120)));
