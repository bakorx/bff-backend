import { Document, Types } from "mongoose";

export interface IUpload extends Document {
  url: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  folder: string;
  uploadedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMigration extends Document {
  name: string;
  migrationId?: string;
  fileName?: string;
  dependsOn?: string[];
  status: "pending" | "success" | "error";
  errorMessage?: string;
  startTime: Date;
  endTime?: Date;
  runAt: Date; // Legacy compatibility
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lifecycle states for any approvable content (courses, quizzes).
 *
 * draft              — being worked on, not yet submitted. Only visible to creator.
 * pending_approval   — submitted by staff/moderator, waiting for an admin to review.
 * approved           — approved by a qualifying admin. Ready to publish.
 * published          — live and accessible to students.
 * archived           — soft-removed from active use. Not deleted, still queryable.
 * rejected           — returned to creator with a reason. Can be revised and resubmitted.
 */
export type ApprovalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "published"
  | "archived"
  | "rejected";

/**
 * A single entry in the approval audit trail.
 * Every status change is recorded here.
 */
export interface IApprovalEvent {
  status: ApprovalStatus;
  actorId: Types.ObjectId;           // user who triggered this transition
  actorLevel: InstitutionLevel;      // the level at which they acted
  actorNodeId: Types.ObjectId;       // the specific node they acted as admin of
  note?: string;                     // optional reviewer comment or rejection reason
  timestamp: Date;
}

/**
 * Approval metadata embedded on any approvable content document.
 *
 * Who can approve:
 *   Any user with role admin or super_admin at the department's level
 *   OR any ancestor node in the dept's lineage (school, college, campus, university).
 *   The approver must be active (IMembership.isActive = true).
 *
 * Embed this interface directly inside ICourse, IQuiz, etc.
 */
export interface IApprovalMeta {
  status: ApprovalStatus;

  /** The dept (or node) that owns this content — approval chain is derived from this */
  ownerDeptId: Types.ObjectId;

  /**
   * Denormalized lineage of the owning dept.
   * Used to query "which admins can approve this?" without tree traversal.
   */
  ownerLineage: {
    universityId: Types.ObjectId;
    campusId: Types.ObjectId;
    collegeId: Types.ObjectId;
    schoolId: Types.ObjectId;
  };

  /** Who submitted it for approval and when */
  submittedBy?: Types.ObjectId;
  submittedAt?: Date;

  /** Most recent approver (for quick display) */
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;

  /** Full audit trail — every transition recorded */
  history: IApprovalEvent[];
}

/**
 * Standalone approval request document.
 * Optional — use if you want a separate collection to query
 * "all pending approvals across the university" from one place.
 *
 * If you embed IApprovalMeta on ICourse/IQuiz directly,
 * you can skip this and query courses/quizzes by approval.status instead.
 */
interface IApproval extends Document {
  contentType: "course" | "quiz";
  contentId: Types.ObjectId;

  approval: IApprovalMeta;

  createdAt: Date;
  updatedAt: Date;
}

export default IApproval;

export interface IPagination {
    page?: number;
    limit?: number;
    search?: string;
}

export interface PaginatedResult<T> {
    data: T[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export type InstitutionLevel = 
| "university"
| "campus"
| "college"
| "school"
| "department"

export interface ISharingScope {
    allResources: boolean;
    allowedCourses?: Types.ObjectId[];
    allowedTags?: string[];
    allowedQuizzes?: Types.ObjectId[];
    allowedMaterials?: Types.ObjectId[];    activeFrom?: Date;
    expiresAt?: Date;
}

export interface ISharingPolicy {
    setByLevel: InstitutionLevel;
    setById: Types.ObjectId;
    
    targetLevel?: InstitutionLevel;
    targetId?: Types.ObjectId;

    enabled: boolean;

    allowCrossCampusSharing?: boolean;
    allowCrossCollegeSharing?: boolean;
    allowCrossSchoolSharing?: boolean;
    allowCrossDeptSharing?: boolean;

    scope?: ISharingScope;

    label?: string;

    isActive: boolean;

    createdAt?: Date;
    updatedAt?: Date;
}

export interface IUniversityOnlySettings {
    requireEmailVerification: boolean;
    defaultStudentCredits: number;
    allowCrossInstitutionSharing: boolean;
}

export interface IBaselineSharingSettings {
    allowCrossCampusSharing: boolean;
    allowCrossCollegeSharing: boolean;
    allowCrossSchoolSharing: boolean;
    allowCrossDeptSharing: boolean;

    defaultScope?: ISharingScope;
}

export interface IWebhookData {
  event: string;
  data: {
    id: number;
    domain: string;
    amount: number;
    currency: string;
    source: string;
    reason: string;
    recipient: number;
    status: string;
    reference: string;
    gateway_response: string;
    channel: string;
    paid_at: string;
    created_at: string;
    updated_at: string;
    metadata: {
      referrer: string;
      custom_fields: Array<{
        display_name: string;
        variable_name: string;
        value: string;
      }>;
      [key: string]: any;
    };
    customer: {
      id: number;
      first_name: string;
      last_name: string;
      email: string;
      customer_code: string;
      phone: string;
      metadata: any;
      risk_action: string;
      international_format_phone: string;
    };
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
      signature: string;
      account_name: string;
      receiver_bank_account_number: string;
      receiver_bank: string;
    };
    fees: number;
    fees_split: any;
    transaction_date: string;
    plan: any;
    subaccount: any;
    order_id: any;
    paidAt: string;
    requested_amount: number;
    pos_transaction_data: any;
    [key: string]: any;
  };
}

export interface IWebhookVerification {
  signature: string;
  timestamp: string;
  body: string;
}

