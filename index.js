require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const userState = {}; 

// --- ԳԼԽԱՎՈՐ ՄԵՆՅՈՒ ---
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('📊 Հաշվեկշիռ', 'ACTION_BALANCE'), Markup.button.callback('📜 Պատմություն', 'ACTION_HISTORY')],
  [Markup.button.callback('➕ Եկամուտ', 'ACTION_INCOME'), Markup.button.callback('➖ Ծախսեր', 'ACTION_EXPENSE')],
  [Markup.button.callback('🎯 Նպատակներ', 'ACTION_GOALS'), Markup.button.callback('🏷 Կատեգորիաներ', 'ACTION_CUSTOM_CATS')],
  [Markup.button.callback('📅 Ամսվա Ռեպորտ', 'ACTION_MONTHLY_REPORT'), Markup.button.callback('📁 CSV (Excel)', 'ACTION_EXPORT_CSV')],
  [Markup.button.callback('🔄 Զրոյացնել', 'ACTION_RESET')]
]);

const cancelMenu = Markup.inlineKeyboard([
  [Markup.button.callback('❌ Չեղարկել', 'ACTION_CANCEL')]
]);

// --- /START ---
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  delete userState[userId];
  
  try {
    const { data } = await supabase.from('transactions').select('id').eq('user_id', userId).limit(1);
    
    if (data && data.length > 0) {
      return ctx.reply('👋 Բարև նորից! Ահա Ձեր գլխավոր մենյուն՝', mainMenu);
    } else {
      userState[userId] = { step: 'SETUP_CARD' };
      return ctx.reply('👋 Բարև! Եկեք կարգավորենք Ձեր բյուջեն:\n\n💳 Մուտքագրեք Ձեր <b>ՔԱՐՏԻ</b> վրա առկա գումարը (օրինակ՝ 50000):', { parse_mode: 'HTML' });
    }
  } catch (error) {
    return ctx.reply('❌ Համակարգային սխալ: Խնդրում ենք փորձել մի փոքր ուշ:');
  }
});

// --- MAIN ACTIONS ---
bot.action('ACTION_BALANCE', (ctx) => {
  ctx.answerCbQuery();
  delete userState[String(ctx.from.id)];
  checkBalance(ctx);
});

bot.action('ACTION_HISTORY', (ctx) => {
  ctx.answerCbQuery();
  delete userState[String(ctx.from.id)];
  fetchHistory(ctx);
});

bot.action('ACTION_INCOME', (ctx) => {
  ctx.answerCbQuery();
  userState[String(ctx.from.id)] = { step: 'AWAIT_INCOME_AMOUNT' };
  ctx.reply('Որքա՞ն գումար ստացաք:\n<i>(Գրեք միայն թվեր, օրինակ՝ 15000)</i>', { parse_mode: 'HTML', ...cancelMenu });
});

bot.action('ACTION_EXPENSE', async (ctx) => {
  ctx.answerCbQuery();
  const userId = String(ctx.from.id);
  await showExpenseCategoriesMenu(ctx, userId);
});

bot.action('ACTION_MONTHLY_REPORT', (ctx) => {
  ctx.answerCbQuery();
  delete userState[String(ctx.from.id)];
  generateMonthlyReport(ctx);
});

bot.action('ACTION_EXPORT_CSV', (ctx) => {
  ctx.answerCbQuery();
  exportToCSV(ctx);
});

bot.action('ACTION_RESET', async (ctx) => {
  ctx.answerCbQuery();
  const userId = String(ctx.from.id);
  await supabase.from('transactions').delete().eq('user_id', userId);
  await supabase.from('goals').delete().eq('user_id', userId);
  await supabase.from('custom_categories').delete().eq('user_id', userId);
  delete userState[userId];
  ctx.reply('🔄 Ձեր բոլոր տվյալները զրոյացվել են: Սեղմեք /start նորից սկսելու համար:');
});

bot.action('ACTION_CANCEL', (ctx) => {
  ctx.answerCbQuery('Գործողությունը չեղարկվեց');
  delete userState[String(ctx.from.id)];
  ctx.reply('🚫 Գործողությունը չեղարկված է:', mainMenu);
});

// --- CUSTOM CATEGORIES ---
bot.action('ACTION_CUSTOM_CATS', async (ctx) => {
  ctx.answerCbQuery();
  const userId = String(ctx.from.id);
  
  const { data: cats } = await supabase.from('custom_categories').select('*').eq('user_id', userId);
  
  let text = '🏷 <b>Ձեր անհատական կատեգորիաները:</b>\n\n';
  if (cats && cats.length > 0) {
    cats.forEach((c, idx) => {
      text += `${idx + 1}. ${c.name} (${c.type === 'expense' ? 'Ծախս' : 'Եկամուտ'})\n`;
    });
  } else {
    text += 'Դեռ չունեք ավելացված անհատական կատեգորիաներ:\n';
  }

  const menu = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Ավելացնել կատեգորիա', 'ADD_CUSTOM_CAT')],
    [Markup.button.callback('⬅️ Հետ', 'ACTION_CANCEL')]
  ]);

  ctx.reply(text, { parse_mode: 'HTML', ...menu });
});

bot.action('ADD_CUSTOM_CAT', (ctx) => {
  ctx.answerCbQuery();
  userState[String(ctx.from.id)] = { step: 'AWAIT_NEW_CAT_NAME' };
  ctx.reply('Գրեք նոր ծախսի կատեգորիայի անվանումը (օրինակ՝ <i>Sport</i>, <i>Կրթություն</i>):', { parse_mode: 'HTML', ...cancelMenu });
});

async function showExpenseCategoriesMenu(ctx, userId) {
  const defaultCats = ['🚗 Տրանսպորտ', '🍔 Ուտելիք', '🛒 Խանութ', '🏠 Բնակարան'];
  const { data: customCats } = await supabase.from('custom_categories').select('name').eq('user_id', userId).eq('type', 'expense');

  const buttons = [];
  defaultCats.forEach(c => buttons.push(Markup.button.callback(c, `CAT_${c}`)));
  if (customCats) {
    customCats.forEach(c => buttons.push(Markup.button.callback(`🏷 ${c.name}`, `CAT_${c.name}`)));
  }
  buttons.push(Markup.button.callback('📦 Այլ (գրել նշում)', 'CAT_Այլ'));

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('❌ Չեղարկել', 'ACTION_CANCEL')]);

  ctx.reply('Ընտրեք ծախսի կատեգորիան:', Markup.inlineKeyboard(rows));
}

bot.action(/CAT_(.+)/, (ctx) => {
  ctx.answerCbQuery();
  const category = ctx.match[1];
  userState[String(ctx.from.id)] = { step: 'AWAIT_EXPENSE_AMOUNT', category: category };
  ctx.reply(`Որքա՞ն ծախսեցիք «<b>${category}</b>»-ի համար:\n<i>(Գրեք միայն թվեր)</i>`, { parse_mode: 'HTML', ...cancelMenu });
});

// --- GOALS ---
bot.action('ACTION_GOALS', async (ctx) => {
  ctx.answerCbQuery();
  const userId = String(ctx.from.id);
  await renderGoalsMenu(ctx, userId);
});

async function renderGoalsMenu(ctx, userId) {
  const { data: goals } = await supabase.from('goals').select('*').eq('user_id', userId);

  let message = '🎯 <b>ԽՆԱՅՈՂՈՒԹՅՈՒՆՆԵՐԻ ՆՊԱՏԱԿՆԵՐ</b>\n➖➖➖➖➖➖➖➖➖➖➖➖\n';
  const buttons = [];

  if (goals && goals.length > 0) {
    goals.forEach(g => {
      const target = parseFloat(g.target_amount);
      const current = parseFloat(g.current_amount);
      const pct = Math.min(100, ((current / target) * 100).toFixed(1));
      const filled = Math.round(pct / 10);
      const bar = '🟩'.repeat(filled) + '⬜️'.repeat(10 - filled);

      message += `📌 <b>${g.title}:</b>\n${current.toLocaleString('hy-AM')} / ${target.toLocaleString('hy-AM')} ֏ (${pct}%)\n${bar}\n\n`;
      buttons.push([Markup.button.callback(`➕ Գումար ավելացնել (${g.title})`, `DEPOSIT_GOAL_${g.id}`)]);
    });
  } else {
    message += 'Դեռ ոչ մի նպատակ չունեք ստեղծած:\n\n';
  }

  buttons.push([Markup.button.callback('➕ Ստեղծել Նոր Նպատակ', 'CREATE_GOAL')]);
  buttons.push([Markup.button.callback('⬅ Հետ', 'ACTION_CANCEL')]);

  ctx.reply(message, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

bot.action('CREATE_GOAL', (ctx) => {
  ctx.answerCbQuery();
  userState[String(ctx.from.id)] = { step: 'AWAIT_GOAL_TITLE' };
  ctx.reply('Գրեք նպատակի անվանումը (օրինակ՝ <i>Արձակուրդ</i>, <i>Նոութբուք</i>):', { parse_mode: 'HTML', ...cancelMenu });
});

bot.action(/DEPOSIT_GOAL_(.+)/, (ctx) => {
  ctx.answerCbQuery();
  const goalId = ctx.match[1];
  userState[String(ctx.from.id)] = { step: 'AWAIT_GOAL_DEPOSIT', goalId: goalId };
  ctx.reply('Որքա՞ն գումար եք ուզում ավելացնել այս նպատակին:', cancelMenu);
});

// --- PAYMENT METHOD ---
bot.action(['PAY_CARD', 'PAY_CASH'], async (ctx) => {
  ctx.answerCbQuery();
  const userId = String(ctx.from.id);
  const state = userState[userId];

  if (!state) return ctx.reply('⚠ Սխալ: Խնդրում ենք սկսել նորից:', mainMenu);

  state.paymentMethod = ctx.match[0] === 'PAY_CARD' ? 'card' : 'cash';

  if (state.category === 'Այլ') {
    state.step = 'AWAIT_DESCRIPTION';
    return ctx.reply('📝 Խնդրում եմ գրեք, թե կոնկրետ ինչի վրա եք ծախսել այս գումարը:', cancelMenu);
  }

  saveTransaction(ctx, userId, state);
});

// --- TEXT MESSAGES HANDLER ---
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = String(ctx.from.id);
  const state = userState[userId] || {};

  if (!state.step) {
    return ctx.reply('Խնդրում եմ ընտրել գործողություն ներքևի կոճակներով:', mainMenu);
  }

  if (state.step === 'AWAIT_NEW_CAT_NAME') {
    await supabase.from('custom_categories').insert([{ user_id: userId, name: text, type: 'expense' }]);
    delete userState[userId];
    return ctx.reply(`✅ «<b>${text}</b>» կատեգորիան հաջողությամբ ավելացվեց:`, { parse_mode: 'HTML', ...mainMenu });
  }

  if (state.step === 'AWAIT_GOAL_TITLE') {
    state.goalTitle = text;
    state.step = 'AWAIT_GOAL_TARGET';
    userState[userId] = state;
    return ctx.reply(`Որքա՞ն է «<b>${text}</b>»-ի թիրախային գումարը:`, { parse_mode: 'HTML', ...cancelMenu });
  }

  if (state.step === 'AWAIT_GOAL_TARGET') {
    if (isNaN(text) || parseFloat(text) <= 0) return ctx.reply('⚠️ Մուտքագրեք ճիշտ թիվ:');
    await supabase.from('goals').insert([{ user_id: userId, title: state.goalTitle, target_amount: parseFloat(text) }]);
    delete userState[userId];
    ctx.reply('🎉 Նպատակը հաջողությամբ ստեղծվեց:');
    return renderGoalsMenu(ctx, userId);
  }

  if (state.step === 'AWAIT_GOAL_DEPOSIT') {
    if (isNaN(text) || parseFloat(text) <= 0) return ctx.reply('⚠️ Մուտքագրեք ճիշտ թիվ:');
    const deposit = parseFloat(text);
    
    const { data: goal } = await supabase.from('goals').select('current_amount').eq('id', state.goalId).single();
    if (goal) {
      const newAmount = parseFloat(goal.current_amount) + deposit;
      await supabase.from('goals').update({ current_amount: newAmount }).eq('id', state.goalId);
    }
    delete userState[userId];
    ctx.reply('✅ Գումարն ավելացվեց նպատակին:');
    return renderGoalsMenu(ctx, userId);
  }

  if (state.step === 'AWAIT_DESCRIPTION') {
    saveTransaction(ctx, userId, state, text);
    return;
  }

  const isAmountStep = ['SETUP_CARD', 'SETUP_CASH', 'AWAIT_INCOME_AMOUNT', 'AWAIT_EXPENSE_AMOUNT'].includes(state.step);
  if (isAmountStep) {
    if (isNaN(text) || parseFloat(text) < 0) {
      return ctx.reply('⚠️ <b>Սխալ մուտքագրում:</b>\nԽնդրում եմ մուտքագրել միայն դրական թվեր:', { parse_mode: 'HTML', ...cancelMenu });
    }
  }

  if (state.step === 'SETUP_CARD') {
    state.cardBalance = parseFloat(text);
    state.step = 'SETUP_CASH';
    userState[userId] = state;
    return ctx.reply('✅ Քարտը պահպանվեց:\n\n💵 Հիմա մուտքագրեք Ձեր <b>ԿԱՆԽԻԿ</b> գումարի չափը:', { parse_mode: 'HTML', ...cancelMenu });
  }

  if (state.step === 'SETUP_CASH') {
    const cashBalance = parseFloat(text);
    try {
      await supabase.from('transactions').insert([
        { user_id: userId, amount: state.cardBalance, category: 'Սկզբնական', type: 'income', payment_method: 'card', description: 'Initial Card' },
        { user_id: userId, amount: cashBalance, category: 'Սկզբնական', type: 'income', payment_method: 'cash', description: 'Initial Cash' }
      ]);
      delete userState[userId];
      return ctx.reply('🎉 Հաշիվը պատրաստ է! Ընտրեք գործողություն:', mainMenu);
    } catch (error) {
      return ctx.reply('❌ Տվյալների բազայի սխալ:', mainMenu);
    }
  }

  if (state.step === 'AWAIT_INCOME_AMOUNT') {
    state.amount = parseFloat(text);
    state.step = 'AWAIT_INCOME_SOURCE';
    userState[userId] = state;
    return ctx.reply('Որտեղի՞ց եկավ այս գումարը (օր.՝ Աշխատավարձ):', cancelMenu);
  }

  if (state.step === 'AWAIT_INCOME_SOURCE') {
    state.category = 'Եկամուտ: ' + text;
    state.isIncome = true;
    userState[userId] = state;
    return askPaymentMethod(ctx, 'Որտե՞ղ ավելացավ այս գումարը:');
  }

  if (state.step === 'AWAIT_EXPENSE_AMOUNT') {
    state.amount = parseFloat(text);
    state.isIncome = false;
    userState[userId] = state;
    return askPaymentMethod(ctx, `Ինչպե՞ս եք վճարել ${state.amount.toLocaleString('hy-AM')} ֏-ը:`);
  }
});

// --- HELPER FUNCTIONS ---
function askPaymentMethod(ctx, messageText) {
  ctx.reply(messageText, Markup.inlineKeyboard([
    [Markup.button.callback('💳 Քարտով', 'PAY_CARD'), Markup.button.callback('💵 Կանխիկ', 'PAY_CASH')],
    [Markup.button.callback('❌ Չեղարկել', 'ACTION_CANCEL')]
  ]));
}

async function saveTransaction(ctx, userId, state, description = '') {
  const type = state.isIncome ? 'income' : 'expense';
  try {
    await supabase.from('transactions').insert([{ 
      user_id: userId, 
      amount: state.amount, 
      category: state.category, 
      type: type, 
      payment_method: state.paymentMethod, 
      description: description 
    }]);
    
    delete userState[userId];
    const descText = description ? `\n📝 Նշում: <i>${description}</i>` : '';
    ctx.reply(`✅ <b>Գրանցվեց:</b>\n\n${type === 'income' ? '➕ Եկամուտ' : '➖ Ծախս'}: ${state.amount.toLocaleString('hy-AM')} ֏\nԿատեգորիա: ${state.category}\nՎճարման եղանակ: ${state.paymentMethod === 'card' ? '💳 Քարտ' : '💵 Կանխիկ'}${descText}`, { parse_mode: 'HTML', ...mainMenu });
  } catch (err) {
    ctx.reply('❌ Տվյալների բազայի սխալ:', mainMenu);
  }
}

async function checkBalance(ctx) {
  const userId = String(ctx.from.id);
  try {
    const { data, error } = await supabase.from('transactions').select('*').eq('user_id', userId);
    if (error) throw error;
    
    let card = 0, cash = 0;
    data.forEach(item => {
      const amount = parseFloat(item.amount);
      if (item.type === 'income') {
        item.payment_method === 'card' ? (card += amount) : (cash += amount);
      } else {
        item.payment_method === 'card' ? (card -= amount) : (cash -= amount);
      }
    });
    
    const receipt = `
🧾 <b>ՖԻՆԱՆՍԱԿԱՆ ՀԱՇՎԵՏՎՈՒԹՅՈՒՆ</b>
➖➖➖➖➖➖➖➖➖➖➖➖
💳 <b>Քարտ:</b>  ${card.toLocaleString('hy-AM')} ֏
💵 <b>Կանխիկ:</b>  ${cash.toLocaleString('hy-AM')} ֏
➖➖➖➖➖➖➖➖➖➖➖➖
💰 <b>Ընդհանուր մնացորդ: ${(card + cash).toLocaleString('hy-AM')} ֏</b>`;

    ctx.reply(receipt, { parse_mode: 'HTML', ...mainMenu });
  } catch (err) {
    ctx.reply('❌ Սխալ՝ բալանսը ստուգելիս:', mainMenu);
  }
}

async function fetchHistory(ctx) {
  const userId = String(ctx.from.id);
  try {
    const { data, error } = await supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    
    if (!data || data.length === 0) return ctx.reply('📭 Պատմությունը դատարկ է:', mainMenu);
    
    let historyText = '📜 <b>Վերջին 10 գործարքները:</b>\n\n';
    data.forEach((item, index) => {
      const icon = item.type === 'income' ? '🟢' : '🔴';
      const method = item.payment_method === 'card' ? '💳' : '💵';
      const date = new Date(item.created_at).toLocaleDateString('hy-AM');
      const desc = item.description ? ` <i>(${item.description})</i>` : '';
      historyText += `${index + 1}. ${icon} ${item.category} | ${item.amount} ֏ | ${method} | ${date}${desc}\n`;
    });
    
    ctx.reply(historyText, { parse_mode: 'HTML', ...mainMenu });
  } catch (err) {
    ctx.reply('❌ Սխալ՝ պատմությունը բեռնելիս:', mainMenu);
  }
}

async function generateMonthlyReport(ctx) {
  const userId = String(ctx.from.id);
  const date = new Date();
  const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1).toISOString();

  try {
    const { data, error } = await supabase.from('transactions').select('*').eq('user_id', userId).gte('created_at', firstDayOfMonth); 
    if (error) throw error;

    let totalExpense = 0, totalExpenseCard = 0, totalExpenseCash = 0;
    const categoryTotals = {};

    data.forEach(item => {
      if (item.type === 'expense') {
        const amount = parseFloat(item.amount);
        totalExpense += amount;
        item.payment_method === 'card' ? (totalExpenseCard += amount) : (totalExpenseCash += amount);
        
        categoryTotals[item.category] = (categoryTotals[item.category] || 0) + amount;
      }
    });

    if (totalExpense === 0) return ctx.reply('Այս ամիս դեռ ոչ մի ծախս չեք գրանցել: 🎉', mainMenu);

    const monthNames = ["Հունվար", "Փետրվար", "Մարտ", "Ապրիլ", "Մայիս", "Հունիս", "Հուլիս", "Օգոստոս", "Սեպտեմբեր", "Հոկտեմբեր", "Նոյեմբեր", "Դեկտեմբեր"];
    let reportMessage = `
📊 <b>ԱՄՍԱԿԱՆ ՀԱՇՎԵՏՎՈՒԹՅՈՒՆ</b>
🗓 <b>Ամիս:</b> ${monthNames[date.getMonth()]} ${date.getFullYear()}
➖➖➖➖➖➖➖➖➖➖➖➖
💸 <b>Ընդհանուր ծախս:</b> ${totalExpense.toLocaleString('hy-AM')} ֏
💳 <b>Քարտով:</b> ${totalExpenseCard.toLocaleString('hy-AM')} ֏
💵 <b>Կանխիկ:</b> ${totalExpenseCash.toLocaleString('hy-AM')} ֏
➖➖➖➖➖➖➖➖➖➖➖➖
📈 <b>Ըստ կատեգորիաների:</b>\n\n`;

    const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([cat, amt]) => {
      const pct = ((amt / totalExpense) * 100).toFixed(1);
      const bar = '🟩'.repeat(Math.round(pct / 10)) + '⬜️'.repeat(10 - Math.round(pct / 10));
      reportMessage += `🔹 <b>${cat}:</b> ${amt.toLocaleString('hy-AM')} ֏ <i>(${pct}%)</i>\n${bar}\n\n`;
    });

    ctx.reply(reportMessage, { parse_mode: 'HTML', ...mainMenu });
  } catch (err) {
    ctx.reply('❌ Սխալ՝ ռեպորտը բեռնելիս:', mainMenu);
  }
}

async function exportToCSV(ctx) {
  const userId = String(ctx.from.id);
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return ctx.reply('📭 Տվյալներ չկան արտահանելու համար:', mainMenu);

    let csvContent = '\uFEFFԱմսաթիվ,Տեսակ,Կատեգորիա,Գումար (֏),Վճարման եղանակ,Նկարագրություն\n';

    data.forEach(item => {
      const date = item.created_at ? new Date(item.created_at).toLocaleDateString('hy-AM') : '';
      const type = item.type === 'income' ? 'Եկամուտ' : 'Ծախս';
      const category = (item.category || '').replace(/"/g, '""');
      const amount = item.amount || 0;
      const method = item.payment_method === 'card' ? 'Քարտ' : (item.payment_method === 'cash' ? 'Կանխիկ' : '-');
      const desc = (item.description || '').replace(/"/g, '""');

      csvContent += `"${date}","${type}","${category}",${amount},"${method}","${desc}"\n`;
    });

    const fileBuffer = Buffer.from(csvContent, 'utf-8');

    await ctx.replyWithDocument({
      source: fileBuffer,
      filename: `finance_report_${new Date().toISOString().slice(0, 10)}.csv`
    });

  } catch (err) {
    console.error('Export CSV Error:', err);
    ctx.reply('❌ Սխալ՝ CSV ֆայլը պատրաստելիս:', mainMenu);
  }
}

// --- VERCEL SERVERLESS HANDLER ---
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).end();
    } else {
      res.status(200).send('Finance Bot Webhook is active on Vercel!');
    }
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).send('Internal Server Error');
  }
};