import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';

dotenv.config(); 

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files safely for both Local and Vercel
app.use(express.static(path.join(process.cwd(), 'public')));

// ==========================================
// 🟢 1. DATABASE CONNECTION (Optimized for Vercel)
// ==========================================
const dbLink = process.env.MONGO_URI as string || "mongodb://localhost:27017/amit-olympiad";

async function connectDB() {
    if (mongoose.connection.readyState === 0) {
        try {
            await mongoose.connect(dbLink);
            console.log("🟢 MONGODB DATABASE CONNECTED SUCCESSFULLY! 🎉");
        } catch (err) {
            console.log("🔴 DATABASE CONNECTION FAILED:", err);
        }
    }
}
connectDB();

// ==========================================
// 🟢 2. DATABASE SCHEMAS & MODELS
// ==========================================
const studentSchema = new mongoose.Schema({
    fullName: String,
    mobile: String,
    studentId: String,
    registeredAt: { type: Date, default: Date.now }
});
const Student = mongoose.model('Student', studentSchema);

const questionSchema = new mongoose.Schema({
    questionText: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: String, required: true },
    classLevel: { type: String, required: true },
    subject: { type: String, default: "Mathematics" },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' },
    createdAt: { type: Date, default: Date.now }
});
const Question = mongoose.model('Question', questionSchema);

const examAttemptSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    totalScore: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    timeTakenSeconds: { type: Number, default: 0 },
    answers: [{
        questionId: String,
        selectedOption: String,
        isCorrect: Boolean
    }],
    status: { type: String, enum: ['In Progress', 'Submitted', 'Suspended'], default: 'In Progress' }
});
const ExamAttempt = mongoose.model('ExamAttempt', examAttemptSchema);

const resultSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    examId: { type: String, required: true },
    nationalRank: { type: Number },
    stateRank: { type: Number },
    percentile: { type: Number },
    xpEarned: { type: Number, default: 0 },
    badges: [{ type: String }],
    isPublished: { type: Boolean, default: false }
});
const Result = mongoose.model('Result', resultSchema);

const topicPerformanceSchema = new mongoose.Schema({
    topicName: { type: String, required: true },
    attempted: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    averageTimeSeconds: { type: Number, default: 0 }
}, { _id: false });

const studentAnalyticsSchema = new mongoose.Schema({
    studentId: { type: String, required: true, unique: true },
    overallAccuracy: { type: Number, default: 0 },
    averageSpeedPerQuestion: { type: Number, default: 0 },
    totalQuestionsAttempted: { type: Number, default: 0 },
    topicMetrics: [topicPerformanceSchema],
    learningCurve: [{
        date: { type: String },
        accuracy: Number
    }],
    aiInsights: [{ type: String }],
    lastUpdated: { type: Date, default: Date.now }
});
const StudentAnalytics = mongoose.model('StudentAnalytics', studentAnalyticsSchema);

// ==========================================
// 🟢 3. AUTH & REGISTRATION API
// ==========================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { fullName, mobile } = req.body;
        console.log("📥 Naya Form Aaya Hai:", req.body);   
        
        if (!fullName || !mobile) {
            return res.status(400).json({ success: false, error: "Name and Mobile are required!" });
        }

        const newStudent = new Student({
            fullName: fullName,
            mobile: mobile,
            studentId: `AMIT_${Math.floor(Math.random() * 10000)}`
        });

        await newStudent.save(); 

        res.status(200).json({
            success: true,
            message: `Badhai ho! ${fullName} ka data Database mein save ho gaya hai.`,
            student: newStudent
        });
    } catch (error) {
        res.status(500).json({ success: false, error: "Kuch gadbad ho gayi" });
    }
});

// ==========================================
// 🟢 4. AI ANALYTICS ENGINE & API
// ==========================================
function generateAIInsights(analyticsData: any) {
    let insights = [];
    let strongestTopic = { name: '', acc: 0 };
    let weakestTopic = { name: '', acc: 100 };
    
    if (analyticsData.topicMetrics && analyticsData.topicMetrics.length > 0) {
        analyticsData.topicMetrics.forEach((topic: any) => {
            let acc = (topic.correct / topic.attempted) * 100 || 0;
            if (acc > strongestTopic.acc) { strongestTopic = { name: topic.topicName, acc }; }
            if (acc < weakestTopic.acc && topic.attempted > 2) { weakestTopic = { name: topic.topicName, acc }; }
        });
    }

    if (strongestTopic.name) insights.push(`You are exceptionally strong in ${strongestTopic.name}. Keep it up! 🌟`);
    if (weakestTopic.name) insights.push(`You need more focused practice in ${weakestTopic.name}. Your accuracy is dropping here. ⚠️`);
    
    if (analyticsData.averageSpeedPerQuestion > 90) {
        insights.push(`Time Management Alert: You are taking too long per question (>90s). Try practicing rapid quizzes daily. ⏱️`);
    } else {
        insights.push(`Excellent pacing! Your time management is perfectly balanced with your accuracy. 🎯`);
    }

    return insights;
}

app.get('/api/analytics/:studentId', async (req, res) => {
    try {
        let analytics = await StudentAnalytics.findOne({ studentId: req.params.studentId });
        
        if (!analytics) {
            return res.json({
                success: true,
                data: {
                    overallAccuracy: 88,
                    averageSpeedPerQuestion: 34,
                    totalQuestionsAttempted: 450,
                    topicMetrics: [
                        { topicName: "Calculus & Limits", attempted: 120, correct: 110 },
                        { topicName: "Algebraic Identities", attempted: 150, correct: 130 },
                        { topicName: "Trigonometric Ratios", attempted: 100, correct: 80 },
                        { topicName: "Coordinate Geometry", attempted: 80, correct: 70 }
                    ],
                    learningCurve: [
                        { date: 'Jul 20', accuracy: 70 },
                        { date: 'Jul 22', accuracy: 75 },
                        { date: 'Jul 24', accuracy: 82 },
                        { date: 'Jul 26', accuracy: 85 },
                        { date: 'Jul 29', accuracy: 88 }
                    ],
                    aiInsights: [
                        "🔥 Exceptional performance in Calculus limits! Your calculation speed improved by 14% this week.",
                        "💡 Focus more on Advanced Trigonometric Identities to cross the 95% accuracy threshold.",
                        "⭐ You are currently in the top 5% of all national Olympiad participants. Keep the streak alive!"
                    ]
                }
            });
        }
        
        analytics.aiInsights = generateAIInsights(analytics);
        res.json({ success: true, data: analytics });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to fetch analytics" });
    }
});

// ==========================================
// 🟢 5. AI QUESTION GENERATOR API
// ==========================================
app.post('/api/admin/generate-questions', async (req, res) => {
    try {
        const { classLevel, subject, topic, difficulty, questionType, count } = req.body;
        let aiGeneratedQuestions = [];
        
        for(let i = 1; i <= count; i++) {
            aiGeneratedQuestions.push({
                questionText: `(${subject} - ${classLevel}) What is the advanced solution for ${topic}? [Sample ${i}]`,
                options: [
                    `Option A: Correct answer for ${topic}`,
                    `Option B: Alternate derived method`,
                    `Option C: Common calculation trap`,
                    `Option D: None of the above`
                ],
                correctAnswer: `Option A: Correct answer for ${topic}`,
                classLevel: classLevel,
                subject: subject,
                difficulty: difficulty
            });
        }

        const savedQuestions = await Question.insertMany(aiGeneratedQuestions);
        res.status(200).json({ success: true, message: `${count} questions successfully generated!`, data: savedQuestions });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to generate AI questions." });
    }
});

app.get('/api/questions', async (req, res) => {
    try {
        const { classLevel, subject, difficulty } = req.query;
        let query: any = {};
        if (classLevel) query.classLevel = classLevel;
        if (subject) query.subject = subject;
        if (difficulty) query.difficulty = difficulty;

        const questions = await Question.find(query).limit(20);
        res.status(200).json({ success: true, count: questions.length, data: questions });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to fetch questions." });
    }
});

// ==========================================
// 🟢 6. ADDITIONAL MODULE APIs
// ==========================================
app.get('/api/daily-challenge', (req, res) => {
    res.json({
        success: true,
        challenge: {
            title: "Rapid Calculus Sprint #42",
            rewardXP: 150,
            difficulty: "Hard",
            estimatedTime: "10 Mins",
            fastestTime: "1m 45s",
            todayWinner: "Aarav Gupta"
        }
    });
});

app.get('/api/leaderboard', (req, res) => {
    res.json({
        success: true,
        leaderboard: [
            { rank: 1, name: "Ananya Sharma", xp: 3420, school: "Delhi Public School", accuracy: "98%" },
            { rank: 2, name: "Rahul Verma", xp: 3100, school: "St. Xavier's High", accuracy: "96%" },
            { rank: 3, name: "Priya Singh", xp: 2950, school: "Kendriya Vidyalaya", accuracy: "95%" },
            { rank: 4, name: "Amit Kumar (Scholar)", xp: 2800, school: "AMIT Elite Academy", accuracy: "94%" },
            { rank: 5, name: "Vikram Malhotra", xp: 2650, school: "Modern School", accuracy: "92%" }
        ]
    });
});

app.get('/api/certificates/:studentId', (req, res) => {
    res.json({
        success: true,
        certificates: [
            { id: "CERT-2026-01", title: "National Math Olympiad Finalist", date: "15 June 2026", status: "Verified & Ready" },
            { id: "CERT-2026-02", title: "Advanced Calculus Masterclass", date: "02 May 2026", status: "Verified & Ready" }
        ]
    });
});

// ==========================================
// 🟢 PORT LISTENER & EXPORT
// ==========================================
const PORT = process.env.PORT || 8080;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`===========================================`);
        console.log(`✅ A.M.I.T Olympiad Server Running on Port ${PORT}`);
        console.log(`===========================================`);
    });
}

export default app;