export const MOTIVATIONAL_QUOTES = [
  "Duty becomes leadership when it is done with care.",
  "A reliable prefect makes the whole school day steadier.",
  "Punctuality is respect made visible.",
  "Lead calmly; consistency speaks louder than a badge.",
  "Small duties completed well build lasting trust.",
  "Responsibility begins before anyone reminds you.",
  "A strong team notices what needs doing and begins.",
  "School pride is shown in the standards we keep.",
  "Leadership is helping others do their best work.",
  "Discipline turns good intentions into dependable action.",
  "Be early, be prepared, and make the duty easier for everyone.",
  "A prefect leads the atmosphere as much as the line.",
  "Good judgment is firm, fair, and never hurried.",
  "The best example is the one repeated every day.",
  "A duty post is a place to practice trust.",
  "Quiet reliability earns lasting respect.",
  "Teamwork begins when credit matters less than the result.",
  "A responsible leader leaves every place better organized.",
  "Every on-time arrival strengthens the whole team.",
  "School spirit grows through service, not slogans.",
  "Notice early, act wisely, and report clearly.",
  "Fairness is leadership with both eyes open.",
  "Prepared prefects create calm school mornings.",
  "Your badge represents the promises you keep.",
  "Respect travels quickly when a leader gives it first.",
  "A good coordinator builds confidence and accountability.",
  "Standards matter most when nobody is checking.",
  "Clear communication is a service to the whole team.",
  "Leadership is steady work, not a special occasion.",
  "The duty you finish today becomes tomorrow's trust.",
  "Discipline protects time for everyone.",
  "Calm attention prevents small issues becoming large ones.",
  "A united prefect team makes responsibility feel possible.",
  "Be the reason a difficult duty runs smoothly.",
  "Good attendance is a habit of respect.",
  "The strongest leaders remain teachable.",
  "Take ownership without taking all the credit.",
  "A prepared mind makes a confident decision.",
  "Service gives authority its purpose.",
  "Consistency is the signature of dependable leadership.",
  "A school community grows stronger through shared responsibility.",
  "Finish the duty with the same care you began it."
];

export function getMotivationalQuote() {
  const key = "ri-recent-quotes";
  const recent = JSON.parse(localStorage.getItem(key) || "[]");
  const fullPool = MOTIVATIONAL_QUOTES.map((quote, index) => ({ quote, index }));
  const pool = fullPool.filter((item) => !recent.includes(item.index));
  const source = pool.length ? pool : fullPool;
  const pick = source[Math.floor(Math.random() * source.length)];
  localStorage.setItem(key, JSON.stringify([pick.index, ...recent.filter((index) => index !== pick.index)].slice(0, 5)));
  return pick.quote;
}
