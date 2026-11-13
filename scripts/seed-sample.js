// Adds a sample survey (all 8 answer types, English + Spanish) so you can try the app right away.
import { openDb, saveSurvey, audit } from '../src/db.js';
import { newId } from '../src/http.js';
import { STATES, newQuestion, surveyPrizeShort, winnersCountOf } from '../public/js/shared.js';

openDb();
const Q = (t, o) => Object.assign(newQuestion(t), o);
const end = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const s = { id: newId('s_'), status: 'live', title: 'Everyday Shopping Habits', title_es: 'Hábitos de compra diarios',
  description: 'Tell us how you shop for groceries and household items. Takes about 3 minutes.', description_es: 'Cuéntanos cómo compras alimentos y artículos para el hogar. Toma unos 3 minutos.',
  tiers: [{ place: 1, winners: 1, notes: 10 }, { place: 2, winners: 5, notes: 5 }, { place: 3, winners: 20, notes: 1 }], noteOz: 0.001, endsAt: end, drawDate: end,
  questions: [
    Q('single', { text: 'Where do you do most of your grocery shopping?', text_es: '¿Dónde haces la mayoría de tus compras de alimentos?', options: ['Supermarket', 'Warehouse club', 'Discount store', 'Online delivery', 'Farmers market'], options_es: ['Supermercado', 'Club de almacén', 'Tienda de descuento', 'Entrega en línea', 'Mercado de agricultores'] }),
    Q('multi', { text: 'Which of these did you buy online in the last month?', text_es: '¿Cuáles de estos compraste en línea el último mes?', options: ['Groceries', 'Household supplies', 'Clothing', 'Electronics', 'Personal care', 'Pet supplies'], options_es: ['Alimentos', 'Artículos para el hogar', 'Ropa', 'Electrónicos', 'Cuidado personal', 'Artículos para mascotas'], max: 3 }),
    Q('dropdown', { text: 'Which state do you live in?', text_es: '¿En qué estado vives?', options: [...STATES] }),
    Q('likert', { text: '"I compare prices before buying everyday items."', text_es: '"Comparo precios antes de comprar artículos de uso diario."', scale: 'agreement', points: 5 }),
    Q('rating', { text: 'How likely are you to recommend your main store to a friend?', text_es: '¿Qué tan probable es que recomiendes tu tienda principal a un amigo?', min: 0, max: 10, lowLabel: 'Not likely at all', lowLabel_es: 'Nada probable', highLabel: 'Very likely', highLabel_es: 'Muy probable' }),
    Q('slider', { text: 'About how much do you spend on groceries per week?', text_es: '¿Cuánto gastas aproximadamente en alimentos por semana?', min: 0, max: 500, step: 10, unit: '$' }),
    Q('matrix', { text: 'How satisfied are you with your main store on…', text_es: '¿Qué tan satisfecho estás con tu tienda principal en…', rows: ['Prices', 'Product quality', 'Checkout speed', 'Staff friendliness'], rows_es: ['Precios', 'Calidad de los productos', 'Rapidez en la caja', 'Amabilidad del personal'], scale: 'satisfaction', points: 5 }),
    Q('text', { text: 'What one thing would make shopping easier for you?', text_es: '¿Qué cosa haría más fácil tus compras?', required: false, placeholder: 'Your idea', placeholder_es: 'Tu idea', maxLength: 140 }),
  ] };
s.winnersCount = winnersCountOf(s); s.prize = surveyPrizeShort(s);
saveSurvey(s); audit(null, 'survey.seed', { id: s.id });
console.log(`Added sample survey "${s.title}" (${s.id}), live until ${end}.`);
