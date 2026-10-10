// Sample calls for the free test mode (/dashboard/test). They mirror the 12 cases in the
// test set (test-set.md) so a reviewer can run every rule through the live system without
// spending Vaani minutes. These are illustrative samples, not the original Nexus transcripts.

import type { TranscriptTurn } from "./types";

export interface Scenario {
  id: string;
  title: string;
  rule: string;
  expected: string; // outcome
  expectedReason?: string; // decline_reason
  phone: string;
  transcript: string;
}

const OPEN =
  "Agent: Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded so our designers can follow up on your project. How can I help you today?";
const PRICE_LINE =
  "Agent: Pricing depends on the site, the materials you choose, and the scope. Your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.";

export const SCENARIOS: Scenario[] = [
  {
    id: "T01",
    title: "3BHK Kothrud, referral, clean pass",
    rule: "Passes all five checks",
    expected: "qualified",
    phone: "+919811100001",
    transcript: `${OPEN}
Caller: Hi, I'm Priya Kulkarni. We've bought a 3BHK in Kothrud, about 1,400 square feet carpet, and we want the whole flat designed and done.
Agent: Lovely. What state is the flat in right now?
Caller: Brand new, bare shell. We got possession last month.
Agent: When would you need the project complete?
Caller: By March next year, so about five months.
Agent: Will you be making the decision, or is someone else involved?
Caller: My husband and I decide together, and he's fine with it.
Agent: What's the best number to reach you on?
Caller: 98111 00001.
Agent: How did you hear about Aangan?
Caller: Shruti Joshi, a past client of yours, recommended you.
Agent: I can book a free consultation with one of our designers. Would you like that at your home or at our studio?
Caller: At home please.`,
  },
  {
    id: "T02",
    title: "2BHK Wakad, asks for a ballpark twice",
    rule: "Pricing deflection; asking never disqualifies",
    expected: "qualified",
    phone: "+919811100002",
    transcript: `${OPEN}
Caller: Hi, I have a 2BHK in Wakad, around 950 square feet. I want full interiors, kitchen, wardrobes, everything.
Caller: Before anything, roughly how much will a 2BHK cost?
${PRICE_LINE}
Caller: Just give me a ballpark, I won't hold you to it.
Agent: I'd rather not give you a number without seeing the site. It would be misleading. The consultation is free and there's no obligation.
Caller: Okay fine. I need it done in about four months.
Agent: Will you be making the decision, or is someone else involved?
Caller: Probably my wife as well, I'll check with her.
Agent: What's the best number to reach you on?
Caller: 98111 00002. Book the consultation at the studio.`,
  },
  {
    id: "T03",
    title: "Home office in Nashik",
    rule: "Out of service area",
    expected: "declined",
    expectedReason: "out_of_area",
    phone: "+919811100003",
    transcript: `${OPEN}
Caller: Hello, this is Suresh Patil. I want my home office done up, design and execution.
Agent: Where is the property?
Caller: It's in Nashik.
Agent: Thank you. I'm sorry, we only work within Pune city and PCMC because that's where our contractor network is. This sounds like it may not be the right fit for us right now, but feel free to reach out if your timeline or scope changes. Thank you for calling.`,
  },
  {
    id: "T04",
    title: "Only wants colour and furniture ideas",
    rule: "Advice only, not a real project",
    expected: "declined",
    expectedReason: "advice_only",
    phone: "+919811100004",
    transcript: `${OPEN}
Caller: Hi, I'm just exploring. I want some ideas for wall colours and what furniture would suit my living room.
Agent: Are you looking for us to design and carry out the work, or mainly for ideas and advice?
Caller: Mainly ideas, I'll get the work done myself later.
Agent: Thank you for being clear. Our minimum engagement is a room redesign with execution, so this sounds like it may not be the right fit for us right now, but feel free to reach out if your scope changes. Thank you for calling.`,
  },
  {
    id: "T07",
    title: "Living room + kitchen before Diwali",
    rule: "Timeline under 8 weeks; later start offered",
    expected: "declined",
    expectedReason: "timeline",
    phone: "+919811100007",
    transcript: `${OPEN}
Caller: Hi, I want my living room and kitchen redone, design and execution, in Baner.
Agent: When would you need the project complete?
Caller: Before Diwali, so in about three weeks.
Agent: I want to be honest, three weeks is too short for us to do a living room and kitchen well; it usually takes eight to ten weeks end to end. If starting a little later works, we could do it properly, for example a November start.
Caller: Hmm, let me think about it and get back to you.
Agent: Of course. This sounds like it may not be the right fit for us right now, but feel free to reach out if your timeline changes. Thank you for calling.`,
  },
  {
    id: "T09",
    title: "Existing client, designer not responding",
    rule: "Existing client: skip qualification, escalate",
    expected: "existing_client",
    phone: "+919811100009",
    transcript: `${OPEN}
Caller: This is Sheetal Deshpande. You're doing my 2BHK in Viman Nagar and my designer Aryan hasn't replied in a week. Work has stopped.
Agent: I'm really sorry. Let me get this to a senior member of the team right now. Can I confirm your name and the project location?
Caller: Sheetal Deshpande, Viman Nagar. I want Nikhil or someone senior to call me.
Agent: A senior person will call you back within fifteen minutes. Thank you for your patience.`,
  },
  {
    id: "T10",
    title: "1BHK Kharadi, volunteers a very low budget",
    rule: "Budget clearly below the floor",
    expected: "declined",
    expectedReason: "budget_mismatch",
    phone: "+919811100010",
    transcript: `${OPEN}
Caller: Hi, I have a 1BHK in Kharadi. I want the kitchen and bedroom done, with execution.
Caller: My budget is only one to one and a half lakh for both.
Agent: I want to be honest with you. That would be well below what a project of that scope costs with us, and I wouldn't want to waste your time with a consultation. A local contractor may be a better fit.
Caller: Okay, thanks for telling me.
Agent: Thank you for calling, and feel free to reach out if your scope changes.`,
  },
  {
    id: "T13",
    title: "3BHK Aundh, presses hard for a range",
    rule: "Pricing deflection under pressure",
    expected: "qualified",
    phone: "+919811100013",
    transcript: `${OPEN}
Caller: I have a 3BHK in Aundh, 1,100 square feet. Full home, design and execution.
Caller: What's your per square foot rate?
${PRICE_LINE}
Caller: Come on, everyone gives a range. Just a rough range.
Agent: I'd rather not give you a number without seeing the site. It would be misleading. The consultation is free and there's no obligation.
Caller: Fine. Needed in about four months. Number is 98111 00013. Book me at home.`,
  },
  {
    id: "T14",
    title: "Son calling for parents in Hadapsar",
    rule: "Decision-maker not on the call: forward with flag",
    expected: "qualified",
    phone: "+919811100014",
    transcript: `${OPEN}
Caller: Hi, I'm calling for my parents. They've bought a 3BHK in Hadapsar and want it fully done.
Agent: Will they be making the decision, or is someone else involved?
Caller: They'll decide, and both of them will attend the consultation.
Agent: When would they need it complete?
Caller: No hard deadline, ideally within six months.
Agent: What's the best number to reach you on?
Caller: 98111 00014.`,
  },
  {
    id: "T15",
    title: "Undri, possession in 6 weeks",
    rule: "Possession date is not a completion deadline",
    expected: "qualified",
    phone: "+919811100015",
    transcript: `${OPEN}
Caller: Hi, I'm Smita. I get possession of my 2BHK in Undri in about six weeks, and I want to start the design now so work can begin right after.
Agent: When would you need the project complete?
Caller: No fixed date, a few months after possession is fine. The builder allows site visits already.
Agent: What's the best number to reach you on?
Caller: 98111 00015. Studio consultation please.`,
  },
  {
    id: "T18",
    title: "180 sq ft coworking pod",
    rule: "Very small commercial: no invented minimum, needs review",
    expected: "needs_review",
    phone: "+919811100018",
    transcript: `${OPEN}
Caller: Hi, I run a small coworking pod in Baner, about 180 square feet. I want it designed and fitted out.
Agent: Thank you. Let me have someone from our team confirm whether we're the right fit. They'll call you back. What's the best number to reach you on?
Caller: 98111 00018.`,
  },
  {
    id: "T19",
    title: "Restaurant in Koregaon Park",
    rule: "Out-of-scope project type",
    expected: "declined",
    expectedReason: "out_of_scope_type",
    phone: "+919811100019",
    transcript: `${OPEN}
Caller: Hi, we're opening a restaurant in Koregaon Park and need the interiors done.
Agent: Thank you for thinking of us. Restaurants need a specialist hospitality studio, which isn't what Aangan does. This sounds like it may not be the right fit for us right now, but feel free to reach out if your scope changes. Thank you for calling.`,
  },
  {
    id: "X-WRONG",
    title: "Wrong number",
    rule: "Not a lead",
    expected: "not_a_lead",
    phone: "+919811100020",
    transcript: `${OPEN}
Caller: Sorry, is this the pizza place?
Agent: No, this is Aangan Studio, an interior design studio. Have a good day!`,
  },
  {
    id: "X-PRICE",
    title: "Agent breaks the price rule (compliance check)",
    rule: "Price quoted by agent must raise an incident",
    expected: "qualified",
    phone: "+919811100021",
    transcript: `${OPEN}
Caller: I have a 2BHK in Baner, full interiors with execution, needed in five months. What does it cost?
Agent: For a 2BHK it's typically around eight to ten lakh.
Caller: Okay, book a consultation at home. My number is 98111 00021.`,
  },
];

/** "Agent: …" / "Caller: …" (also AGENT:/USER: and [hh:mm:ss] prefixes) → turns. */
export function parseSimTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:\[[\d:]+\]\s*)?(agent|assistant|caller|user|customer)\s*:\s*(.*)$/i.exec(line);
    if (m) turns.push({ role: /^(agent|assistant)$/i.test(m[1]) ? "agent" : "caller", text: m[2].trim() });
    else if (line.trim() && turns.length) turns[turns.length - 1].text += ` ${line.trim()}`;
  }
  return turns.filter((t) => t.text);
}
