import { Types } from "mongoose";
import { Package, Payment, Subscription } from "./models";
import { applySearchFilters, IPaginationOptions } from "@/utils";

// --- PACKAGE SELECTORS ---
export const getPackageById = (id: string | Types.ObjectId) => Package.findById(id).lean();
export const getPackageByDiscountCode = (discountCode: string) => Package.findOne({ discountCode }).lean();
export const getAllPackages = (options?: IPaginationOptions) => applySearchFilters(Package.find().lean(), options);

// --- PAYMENT SELECTORS ---
export const getPaymentById = (id: string | Types.ObjectId) => Payment.findById(id).lean();
export const getPaymentByReference = (reference: string) => Payment.findOne({ reference }).lean();
export const getPaymentsByUser = (userId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(Payment.find({ userId }).lean(), options);
export const getSuccessfulPaymentsByUser = (userId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(Payment.find({ userId, status: 'success' }).lean(), options);
export const getAllPayments = (options?: IPaginationOptions) => applySearchFilters(Payment.find().lean(), options);

// --- SUBSCRIPTION SELECTORS ---
export const getSubscriptionById = (id: string | Types.ObjectId) => Subscription.findById(id).lean();
export const getSubscriptionsByUser = (userId: string | Types.ObjectId, options?: IPaginationOptions) => applySearchFilters(Subscription.find({ userId }).lean(), options);
export const getActiveSubscriptionByUser = (userId: string | Types.ObjectId) => Subscription.findOne({ userId, status: 'active' }).sort({ createdAt: -1 }).lean();
export const getAllSubscriptions = (options?: IPaginationOptions) => applySearchFilters(Subscription.find().lean(), options);

// --- COUNT SELECTORS ---
export const countAllPackages = (filter: Record<string, any> = {}) => Package.countDocuments(filter);
export const countAllPayments = (filter: Record<string, any> = {}) => Payment.countDocuments(filter);
export const countAllSubscriptions = (filter: Record<string, any> = {}) => Subscription.countDocuments(filter);
export const countSubscriptionsByUser = (userId: string | Types.ObjectId) => Subscription.countDocuments({ userId });

