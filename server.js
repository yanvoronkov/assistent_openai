import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import https from 'node:https'; // Импортируем модуль https

const app = express();
const port = process.env.PORT || 443;

// Инициализация клиента OpenAI
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY, // Убедись, что OPENAI_API_KEY установлен в .env
});

// Хранилище для Thread ID (в памяти)
const threadStore = {};

app.use(express.json());

app.get('/', (req, res) => {
	res.send('Hello from Express!');
});

app.post('/webhook', async (req, res) => {
	console.log('Received webhook from Salebot:', req.body);

	try {
		// 1. Извлечение ID пользователя/диалога из запроса Salebot.
		const userId = req.body.client_id; //  !!! АДАПТИРУЙ ПОД РЕАЛЬНЫЙ ФОРМАТ !!!
		if (!userId) {
			throw new Error("Missing user_id in request body");
		}

		// 2. Получение или создание Thread ID
		let threadId = threadStore[userId];
		if (!threadId) {
			const thread = await openai.beta.threads.create();
			threadId = thread.id;
			threadStore[userId] = threadId;
			console.log(`New thread created for user ${userId}: ${threadId}`);
		} else {
			console.log(`Existing thread found for user ${userId}: ${threadId}`);
		}

		// 3. Добавление сообщения в поток
		const messageText = req.body.message_text;  // !!! АДАПТИРУЙ ПОД РЕАЛЬНЫЙ ФОРМАТ !!!
		if (!messageText) {
			throw new Error("Missing message in request body");
		}

		await openai.beta.threads.messages.create(threadId, {
			role: "user",
			content: messageText,
		});

		// 4. Запуск ассистента
		const assistantId = process.env.OPENAI_ASSISTANT_ID;  // !!! Установи OPENAI_ASSISTANT_ID в .env
		if (!assistantId) {
			throw new Error("Missing OPENAI_ASSISTANT_ID in .env file")
		}
		const run = await openai.beta.threads.runs.create(threadId, {
			assistant_id: assistantId,
		});

		// 5. Ожидание завершения выполнения и получение ответа
		let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
		while (runStatus.status !== "completed") {
			await new Promise((resolve) => setTimeout(resolve, 2000)); // Пауза 2 секунды
			runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);

			if (runStatus.status === "failed" || runStatus.status === "cancelled" || runStatus.status === "expired") {
				throw new Error(`Run failed with status: ${runStatus.status}`);
			}
		}

		const messages = await openai.beta.threads.messages.list(threadId);
		const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
		if (assistantMessages.length === 0) {
			throw new Error("No assistant messages found after run completion")
		}
		const lastAssistantMessage = assistantMessages[0];

		const responseText = lastAssistantMessage.content.map(item => {
			if (item.type === 'text') {
				return item.text.value;
			}
			return '';
		}).join(' ');


		// 6. Отправка ответа обратно в Salebot
		await sendToSalebot(responseText, userId); // Используем функцию sendToSalebot

		res.status(200).json({ reply: responseText }); // Отправляем ответ клиенту (необязательно, если Salebot не ожидает ответа)

	} catch (error) {
		// 7. Обработка ошибок
		console.error("Error processing webhook:", error);
		res.status(500).send({ error: error.message });
	}
});


// Функция для отправки сообщения в Salebot
function sendToSalebot(message, clientId) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify({
			message: message,
			client_id: clientId, // Используем client_id, полученный из Salebot
		});

		const options = {
			hostname: 'chatter.salebot.pro',
			path: '/api/SALEBOT_API_TOKEN/message',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': data.length,
			},
			family: 4, // ДОБАВЬ ЭТУ СТРОКУ
		};

		const req = https.request(options, (res) => {
			let responseData = '';

			res.on('data', (chunk) => {
				responseData += chunk;
			});

			res.on('end', () => {
				console.log('Salebot response:', responseData); // Логируем ответ Salebot
				resolve(); // Успешно отправили
			});
		});

		req.on('error', (error) => {
			console.error('Error sending to Salebot:', error);
			reject(error); // Ошибка отправки
		});

		req.write(data);
		req.end();
	});
}


app.listen(port, () => {
	console.log(`Example app listening on port ${port}!`);
});


// import 'dotenv/config';
// import express from 'express';
// import https from 'node:https';
// import { GoogleGenerativeAI } from "@google/generative-ai";

// const app = express();
// const port = process.env.PORT || 3000;

// // Инициализация Gemini
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// // Хранилище для истории диалогов (в памяти)
// const conversationHistory = {};

// app.use(express.json());

// app.get('/', (req, res) => {
// 	res.send('Hello from Express!');
// });

// app.post('/webhook', async (req, res) => {
// 	console.log('Received webhook from Salebot:', req.body);

// 	try {
// 		const userId = req.body.client_id;
// 		const messageText = req.body.message_text;

// 		if (!userId) {
// 			throw new Error("Missing client_id in request body");
// 		}
// 		if (!messageText) {
// 			throw new Error("Missing message_text in request body");
// 		}

// 		let history = conversationHistory[userId];
// 		if (!history) {
// 			history = [];
// 			conversationHistory[userId] = history;
// 			console.log(`New conversation started for user ${userId}`);
// 		} else {
// 			console.log(`Existing conversation found for user ${userId}`);
// 		}

// 		history.push({ role: "user", parts: [{ text: messageText }] }); // ИСПРАВЛЕНО

// 		const chat = model.startChat({
// 			history: history,
// 			generationConfig: {
// 				maxOutputTokens: 1000,
// 			},
// 		});

// 		const result = await chat.sendMessage(messageText);
// 		const responseText = result.response.text();

// 		history.push({ role: "model", parts: [{ text: responseText }] }); // ИСПРАВЛЕНО

// 		await sendToSalebot(responseText, userId);

// 		res.status(200).json({ reply: responseText });

// 	} catch (error) {
// 		console.error("Error processing webhook:", error);
// 		console.error(error.stack);
// 		res.status(500).send({ error: error.message });
// 	}
// });

// // ... (sendToSalebot - без изменений) ...

// app.listen(port, () => {
// 	console.log(`Example app listening on port ${port}!`);
// });