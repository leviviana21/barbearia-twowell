const { Client, LocalAuth } = require('whatsapp-web.js');
const { google } = require('googleapis');
const path = require('path');

const KEYFILEPATH = path.join(__dirname, 'credenciais.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ],
    }
});

async function createCalendarEvent(summary, description, startDateTime, endDateTime) {
    const calendar = google.calendar({ version: 'v3', auth });

    try {
        const event = {
            summary: summary,
            description: description,
            start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
            end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
        };

        const res = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });

        return res.data;
    } catch (error) {
        console.error('Erro ao criar evento no Google Calendar:', error);
        return null;
    }
}

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado e pronto para agendar.');
});

client.on('authenticated', () => {
    console.log('Autenticado com sucesso! A sessão foi salva.');
});

client.initialize();

const userState = {};

async function sendMessageWithTyping(chat, message) {
    await chat.sendStateTyping();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await client.sendMessage(chat.id._serialized, message);
}

client.on('message', async msg => {
    if (!msg.from.endsWith('@c.us')) return;

    const chat = await msg.getChat();
    const user = msg.from;

    if (userState[user] === 'awaiting_datetime') {
        const text = msg.body;
        try {
            const [datePart, timePart] = text.split(' ');
            if (!datePart || !timePart) throw new Error('Formato inválido');

            const [day, month, year] = datePart.split('/');
            const [hour, minute] = timePart.split(':');

            if (!day || !month || !year || !hour || !minute) throw new Error('Formato incompleto');

            const startDateTime = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));

            if (isNaN(startDateTime.getTime())) throw new Error('Data inválida');

            const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

            await sendMessageWithTyping(chat, `Confirmando agendamento para ${text}. Só um momento...`);

            const event = await createCalendarEvent(
                'Corte de Cabelo - Barbearia TwoWell',
                `Agendamento para o cliente com WhatsApp: ${user}`,
                startDateTime,
                endDateTime
            );

            if (event && event.htmlLink) {
                await sendMessageWithTyping(chat, `✅ Ótimo! Seu horário foi agendado com sucesso.\n\nVocê pode ver os detalhes aqui: ${event.htmlLink}`);
            } else {
                await sendMessageWithTyping(chat, '❌ Desculpe, não consegui agendar seu horário. Parece que houve um erro com a nossa agenda. Por favor, tente falar com um atendente.');
            }

        } catch (e) {
            console.error("Erro ao processar data/hora:", e.message);
            await sendMessageWithTyping(chat, '❌ Ops! O formato de data e hora parece inválido. Por favor, envie novamente usando *DD/MM/AAAA HH:MM* (exemplo: 25/12/2025 15:00).');
            return;
        }

        delete userState[user];
        return;
    }

    if (msg.body.match(/^(menu|oi|olá|ola|bom dia|boa tarde|boa noite|borel|opa)$/i)) {
        const contact = await msg.getContact();
        const name = contact.pushname || 'parceiro';
        const welcomeMessage = `Forte Abraço, ${name.split(" ")[0]}!\n\nComo posso te ajudar hoje? Escolha uma das opções abaixo:\n\n*1* - Agendar um horário 🗓️\n*2* - Tabela de preços 💰\n*3* - Nossos Serviços 💈\n*4* - Falar com o Borel 👨‍💼\n*5* - Dúvidas Frequentes 🤔`;
        await sendMessageWithTyping(chat, welcomeMessage);
        return;
    }

    switch (msg.body.trim().charAt(0)) {
        case '1':
            await sendMessageWithTyping(chat, 'Beleza! Para agendar, por favor, me diga o dia e a hora que você gostaria.\n\nUse o formato *DD/MM/AAAA HH:MM* (ex: 25/12/2025 15:00).');
            userState[user] = 'awaiting_datetime';
            break;
        case '2':
            const prices = `Aqui estão nossos preços:\n\n*Corte Masculino:* R$ 40,00\n*Barba:* R$ 30,00\n*Corte + Barba:* R$ 65,00\n*Pezinho:* R$ 15,00\n\nQualquer dúvida, é só chamar!`;
            await sendMessageWithTyping(chat, prices);
            break;
        case '3':
            const services = `Oferecemos o melhor para o seu estilo:\n\n- Cortes modernos e clássicos\n- Design e manutenção de barba\n- Hidratação capilar e de barba\n\nNosso objetivo é garantir que você saia daqui renovado!`;
            await sendMessageWithTyping(chat, services);
            break;
        case '4':
            await sendMessageWithTyping(chat, 'Para falar diretamente com o Borel, você pode ligar ou mandar uma mensagem para o número (XX) XXXXX-XXXX. Se for urgente, pode ligar, beleza?');
            break;
        case '5':
            const faq = `Algumas dúvidas comuns:\n\n*Qual o horário de funcionamento?*\nTer a Qui: 10h às 21h\nSex e Sáb: 9h às 22h\n\n*Onde fica a barbearia?*\nR. Alarico de Toledo Piza, 788 - Vila Silva Teles, São Paulo - SP, 08110-180\n\n*Aceitam cartão?*\nSim! Aceitamos crédito, débito e PIX.`;
            await sendMessageWithTyping(chat, faq);
            break;
    }
});