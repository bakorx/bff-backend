import { Types } from "mongoose";
import { AiResponse, AiUsageTransaction, ChatbotPersona, StudyPartnerSession } from "./models";
import { applySearchFilters, IPaginationOptions } from "@/utils";

// --- AI RESPONSE SELECTORS ---
export const getAiResponseById = (id: string | Types.ObjectId) => AiResponse.findById(id).lean();
export const getAiResponsesByUser = (userId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(AiResponse.find({ userId }).lean(), options);
export const getAiResponsesBySession = (sessionId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(AiResponse.find({ sessionId }).lean(), options);
export const getAllAiResponses = (options?: IPaginationOptions) => applySearchFilters(AiResponse.find().lean(), options);

// --- AI USAGE TRANSACTION SELECTORS ---
export const getTransactionById = (id: string | Types.ObjectId) => AiUsageTransaction.findById(id).lean();
export const getTransactionsByUser = (userId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(AiUsageTransaction.find({ userId }).lean(), options);
export const getAllTransactions = (options?: IPaginationOptions) => applySearchFilters(AiUsageTransaction.find().lean(), options);

// --- CHATBOT PERSONA SELECTORS ---
export const getPersonaById = (id: string | Types.ObjectId) => ChatbotPersona.findById(id).lean();
export const getActivePersonas = (options?: IPaginationOptions) => applySearchFilters(ChatbotPersona.find({ isActive: true }).lean(), options);
export const getDefaultPersonas = (options?: IPaginationOptions) => applySearchFilters(ChatbotPersona.find({ isDefault: true, isActive: true }).lean(), options);
export const getPersonasBySchool = (schoolId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(ChatbotPersona.find({ schoolId, isActive: true }).lean(), options);
export const getAllPersonas = (options?: IPaginationOptions) => applySearchFilters(ChatbotPersona.find().lean(), options);

// --- STUDY PARTNER SESSION SELECTORS ---
export const getSessionById = (id: string | Types.ObjectId) => StudyPartnerSession.findById(id).lean();
export const getSessionByGuid = (sessionId: string) => StudyPartnerSession.findOne({ sessionId }).lean();
export const getActiveSessionsByUser = (userId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(StudyPartnerSession.find({ participants: userId, isActive: true }).lean(), options);
export const getSessionsByCourse = (courseId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(StudyPartnerSession.find({ courseId }).lean(), options);
export const getAllSessions = (options?: IPaginationOptions) => applySearchFilters(StudyPartnerSession.find().lean(), options);

