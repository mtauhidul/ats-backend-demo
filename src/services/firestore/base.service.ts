import {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
  Firestore,
  Query,
  QuerySnapshot,
  Timestamp,
  WhereFilterOp,
} from "firebase-admin/firestore";
import { getFirestoreDB } from "../../config/firebase";
import logger from "../../utils/logger";

export interface QueryFilter {
  field: string;
  operator: WhereFilterOp;
  value: any;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: {
    field: string;
    direction: "asc" | "desc";
  }[];
}

/**
 * Base Firestore Service
 * Provides common CRUD operations for all Firestore collections
 *
 * @template T - The type of document in the collection
 */
export class FirestoreBaseService<T extends Record<string, any>> {
  protected db: Firestore;
  protected collectionPath: string;

  constructor(collectionPath: string) {
    this.db = getFirestoreDB();
    this.collectionPath = collectionPath;
  }

  /**
   * Get collection reference
   */
  protected getCollection(): CollectionReference {
    return this.db.collection(this.collectionPath);
  }

  /**
   * Get document reference
   */
  protected getDocRef(id: string): DocumentReference {
    return this.getCollection().doc(id);
  }

  /**
   * Convert Firestore Timestamp to Date
   */
  protected convertTimestamps(data: any): any {
    if (!data) return data;

    // Handle arrays - MUST check before object spread
    if (Array.isArray(data)) {
      return data.map((item) => this.convertTimestamps(item));
    }

    // Handle objects (but not arrays, which were handled above)
    if (typeof data === "object" && data !== null) {
      const converted: any = {};
      Object.keys(data).forEach((key) => {
        if (data[key] instanceof Timestamp) {
          converted[key] = data[key].toDate();
        } else if (Array.isArray(data[key])) {
          // Preserve arrays
          converted[key] = data[key].map((item: any) => this.convertTimestamps(item));
        } else if (
          typeof data[key] === "object" &&
          data[key] !== null
        ) {
          converted[key] = this.convertTimestamps(data[key]);
        } else {
          converted[key] = data[key];
        }
      });
      return converted;
    }

    return data;
  }

  /**
   * Convert Date to Firestore Timestamp
   */
  protected convertDatesToTimestamps(data: any): any {
    if (!data) return data;

    // Handle arrays - MUST check before object spread
    if (Array.isArray(data)) {
      return data.map((item) => this.convertDatesToTimestamps(item));
    }

    // Handle objects (but not arrays, which were handled above)
    if (typeof data === "object" && data !== null) {
      const converted: any = {};
      Object.keys(data).forEach((key) => {
        const value = data[key];
        
        // Skip Firestore sentinel values (FieldValue.serverTimestamp(), etc.)
        // These have no enumerable keys and specific constructor names
        if (value && typeof value === 'object' && 
            Object.keys(value).length === 0 && 
            value.constructor?.name?.includes('Transform')) {
          converted[key] = value;
        } else if (value instanceof Date) {
          converted[key] = Timestamp.fromDate(value);
        } else if (Array.isArray(value)) {
          // Preserve arrays
          converted[key] = value.map((item: any) => this.convertDatesToTimestamps(item));
        } else if (typeof value === "object" && value !== null) {
          converted[key] = this.convertDatesToTimestamps(value);
        } else {
          converted[key] = value;
        }
      });
      return converted;
    }

    return data;
  }

  /**
   * Create a new document
   */
  async create(data: Omit<T, "id">): Promise<string> {
    try {
      const timestamp = FieldValue.serverTimestamp();
      const docRef = this.getCollection().doc(); // Generate ID first
      const docData = this.convertDatesToTimestamps({
        ...data,
        id: docRef.id, // Add id field
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await docRef.set(docData);
      logger.debug(`Document created in ${this.collectionPath}:`, docRef.id);
      return docRef.id;
    } catch (error) {
      logger.error(`Error creating document in ${this.collectionPath}:`, error);
      throw error;
    }
  }

  /**
   * Create document with specific ID
   */
  async createWithId(id: string, data: Omit<T, "id">): Promise<void> {
    try {
      const timestamp = FieldValue.serverTimestamp();
      const docData = this.convertDatesToTimestamps({
        ...data,
        id, // Add id field
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await this.getDocRef(id).set(docData);
      logger.debug(`Document created with ID ${id} in ${this.collectionPath}`);
    } catch (error) {
      logger.error(
        `Error creating document with ID in ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Find document by ID
   */
  async findById(id: string): Promise<(T & { id: string }) | null> {
    try {
      const doc: DocumentSnapshot = await this.getDocRef(id).get();

      if (!doc.exists) {
        return null;
      }

      const data = this.convertTimestamps(doc.data());
      return { id: doc.id, ...data } as T & { id: string };
    } catch (error) {
      logger.error(
        `Error finding document by ID in ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Find all documents (use with caution on large collections)
   */
  async findAll(options?: QueryOptions): Promise<(T & { id: string })[]> {
    try {
      let query: Query = this.getCollection();

      // Apply ordering
      if (options?.orderBy) {
        options.orderBy.forEach(({ field, direction }) => {
          query = query.orderBy(field, direction);
        });
      }

      // Apply pagination
      if (options?.offset) {
        query = query.offset(options.offset);
      }
      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const snapshot: QuerySnapshot = await query.get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...this.convertTimestamps(doc.data()),
      })) as (T & { id: string })[];
    } catch (error) {
      logger.error(
        `Error finding all documents in ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Find documents with filters
   */
  async find(
    filters: QueryFilter[],
    options?: QueryOptions
  ): Promise<(T & { id: string })[]> {
    try {
      let query: Query = this.getCollection();

      // Apply filters
      filters.forEach(({ field, operator, value }) => {
        query = query.where(field, operator, value);
      });

      // Apply ordering
      if (options?.orderBy) {
        options.orderBy.forEach(({ field, direction }) => {
          query = query.orderBy(field, direction);
        });
      }

      // Apply pagination
      if (options?.offset) {
        query = query.offset(options.offset);
      }
      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const snapshot: QuerySnapshot = await query.get();
      const docs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...this.convertTimestamps(doc.data()),
      })) as (T & { id: string })[];
      
      return docs;
    } catch (error) {
      logger.error(
        `Error finding documents with filters in ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Find one document with filters
   */
  async findOne(filters: QueryFilter[]): Promise<(T & { id: string }) | null> {
    const results = await this.find(filters, { limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Update document by ID
   */
  async update(id: string, data: Partial<T>): Promise<void> {
    try {
      const docData = this.convertDatesToTimestamps({
        ...data,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await this.getDocRef(id).update(docData);
      logger.debug(`Document updated in ${this.collectionPath}:`, id);
    } catch (error) {
      logger.error(`Error updating document in ${this.collectionPath}:`, error);
      throw error;
    }
  }

  /**
   * Update or create (upsert) document
   */
  async upsert(id: string, data: Partial<T>): Promise<void> {
    try {
      const docData = this.convertDatesToTimestamps({
        ...data,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await this.getDocRef(id).set(docData, { merge: true });
      logger.debug(`Document upserted in ${this.collectionPath}:`, id);
    } catch (error) {
      logger.error(
        `Error upserting document in ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete document by ID
   */
  async delete(id: string): Promise<void> {
    try {
      await this.getDocRef(id).delete();
      logger.debug(`Document deleted from ${this.collectionPath}:`, id);
    } catch (error) {
      logger.error(
        `Error deleting document from ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Batch delete documents
   */
  async batchDelete(ids: string[]): Promise<void> {
    try {
      const batch = this.db.batch();
      ids.forEach((id) => {
        batch.delete(this.getDocRef(id));
      });
      await batch.commit();
      logger.debug(
        `Batch deleted ${ids.length} documents from ${this.collectionPath}`
      );
    } catch (error) {
      logger.error(
        `Error batch deleting documents from ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Count documents with filters
   */
  async count(filters?: QueryFilter[]): Promise<number> {
    try {
      let query: Query = this.getCollection();

      if (filters) {
        filters.forEach(({ field, operator, value }) => {
          query = query.where(field, operator, value);
        });
      }

      const snapshot = await query.count().get();
      return snapshot.data().count;
    } catch (error) {
      logger.error(
        `Error counting documents in ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Check if document exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      const doc = await this.getDocRef(id).get();
      return doc.exists;
    } catch (error) {
      logger.error(
        `Error checking document existence in ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Batch create documents
   */
  async batchCreate(documents: Omit<T, "id">[]): Promise<string[]> {
    try {
      const batch = this.db.batch();
      const ids: string[] = [];
      const timestamp = FieldValue.serverTimestamp();

      documents.forEach((data) => {
        const docRef = this.getCollection().doc();
        const docData = this.convertDatesToTimestamps({
          ...data,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        batch.set(docRef, docData);
        ids.push(docRef.id);
      });

      await batch.commit();
      logger.debug(
        `Batch created ${documents.length} documents in ${this.collectionPath}`
      );
      return ids;
    } catch (error) {
      logger.error(
        `Error batch creating documents in ${this.collectionPath}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Transaction helper
   */
  async runTransaction<R>(
    updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<R>
  ): Promise<R> {
    return this.db.runTransaction(updateFunction);
  }

  /**
   * Subscribe to document changes (real-time)
   * Returns unsubscribe function
   */
  subscribeToDocument(
    id: string,
    callback: (doc: (T & { id: string }) | null) => void
  ): () => void {
    const unsubscribe = this.getDocRef(id).onSnapshot(
      (doc) => {
        if (doc.exists) {
          const data = this.convertTimestamps(doc.data());
          callback({ id: doc.id, ...data } as T & { id: string });
        } else {
          callback(null);
        }
      },
      (error) => {
        logger.error(
          `Error in document subscription for ${this.collectionPath}/${id}:`,
          error
        );
      }
    );

    return unsubscribe;
  }

  /**
   * Subscribe to collection changes (real-time)
   * Returns unsubscribe function
   */
  subscribeToCollection(
    filters: QueryFilter[],
    callback: (docs: (T & { id: string })[]) => void,
    options?: QueryOptions
  ): () => void {
    let query: Query = this.getCollection();

    // Apply filters
    filters.forEach(({ field, operator, value }) => {
      query = query.where(field, operator, value);
    });

    // Apply ordering
    if (options?.orderBy) {
      options.orderBy.forEach(({ field, direction }) => {
        query = query.orderBy(field, direction);
      });
    }

    // Apply limit
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const unsubscribe = query.onSnapshot(
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...this.convertTimestamps(doc.data()),
        })) as (T & { id: string })[];
        callback(docs);
      },
      (error) => {
        logger.error(
          `Error in collection subscription for ${this.collectionPath}:`,
          error
        );
      }
    );

    return unsubscribe;
  }
}
