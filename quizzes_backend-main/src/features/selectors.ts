import { FeatureFlag } from "./models";

export const getAllFlags = () =>
  FeatureFlag.find().sort({ key: 1 }).lean();

export const getFlagByKey = (key: string) =>
  FeatureFlag.findOne({ key }).lean();
