"use strict";

/**
 * Account Model
 *
 * Manages multi-tenant accounts in the `accounts` table. Each account represents
 * an organization/workspace with an owner and optional members.
 *
 * Key operations:
 * - create / get / getAll / getUserAccounts: CRUD for accounts
 * - addUserToAccount / removeUserFromAccount: Manage account membership
 * - linkNewUserToAccount: Create account and assign owner in one step
 */

const db = require("../db");
const {
  NotFoundError,
  BadRequestError
} = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");
const { generateAccountUrl } = require("../services/accountService");
const { isAccountLinkedToUser } = require("../helpers/accountUsers");

class Account {

  /** Create a new account.
   *
   * Data: { name, ownerUserId }
   *
   * Returns { id, name, url, ownerUserId, createdAt, updatedAt }
   *
   * Throws BadRequestError if name or ownerUserId is missing.
   **/
  static async create({ name, ownerUserId }) {
    if (!name) {
      throw new BadRequestError("Name is required to create an account");
    }
    if (!ownerUserId) {
      throw new BadRequestError("Owner user ID is required to create an account");
    }

    const url = await generateAccountUrl(name);

    const result = await db.query(
      `INSERT INTO accounts (
              name,
              url,
              owner_user_id)
       VALUES ($1, $2, $3)
       RETURNING id,
              name,
              url,
              owner_user_id AS "ownerUserId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"`,
      [name, url, ownerUserId]
    );

    return result.rows[0];
  }

  /** Get a specific account by id.
   *
   * Returns { id, name, url, ownerUserId, createdAt, updatedAt }
   *
   * Throws NotFoundError if account not found.
   **/
  static async get(id) {
    const result = await db.query(
      `SELECT id,
              name,
              url,
              owner_user_id AS "ownerUserId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM accounts
       WHERE id = $1`,
      [id]
    );

    const account = result.rows[0];
    if (!account) throw new NotFoundError(`No account with id: ${id}`);

    return account;
  }

  /** Get all accounts.
   *
   * Returns [{ id, name, url, ownerUserId, createdAt, updatedAt }, ...]
   *
   * Throws NotFoundError if no accounts are found.
   **/
  static async getAll() {
    const result = await db.query(
      `SELECT id,
              name,
              url,
              owner_user_id AS "ownerUserId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM accounts`
    );

    const accounts = result.rows;
    if (accounts.length === 0) throw new NotFoundError("No accounts found");

    return accounts;
  }

  /** Get all accounts for a specific user.
   *
   * @param {number} userId
   * @returns [{ id, name, url, ownerUserId, createdAt, updatedAt }, ...]
   *
   * Throws NotFoundError if user has no accounts.
   **/
  static async getUserAccounts(userId) {
    const result = await db.query(
      `SELECT a.id,
              a.name,
              a.url,
              a.owner_user_id AS "ownerUserId",
              a.created_at AS "createdAt",
              a.updated_at AS "updatedAt"
       FROM accounts a
       JOIN account_users au ON a.id = au.account_id
       WHERE au.user_id = $1
       ORDER BY (a.owner_user_id = $1) DESC, a.created_at ASC`,
      [userId]
    );

    const accounts = result.rows;
    if (accounts.length === 0) throw new NotFoundError(`No accounts found for user with ID: ${userId}`);

    return accounts;
  }

  /** Update account data with `data`.
   *
   * Data can include: { name, url }
   *
   * Returns { id, name, url, ownerUserId, createdAt, updatedAt }
   *
   * Throws NotFoundError if account not found.
   **/
  static async update(id, data) {
    const { setCols, values } = sqlForPartialUpdate(data, {});
    const idVarIdx = "$" + (values.length + 1);

    const querySql = `
      UPDATE accounts
      SET ${setCols}
      WHERE id = ${idVarIdx}
      RETURNING id,
                name,
                url,
                owner_user_id AS "ownerUserId",
                created_at AS "createdAt",
                updated_at AS "updatedAt"`;
    const result = await db.query(querySql, [...values, id]);
    const account = result.rows[0];

    if (!account) throw new NotFoundError(`No account with id: ${id}`);

    return account;
  }

  /** Remove an account.
   *
   * Returns { deleted: id }
   *
   * Throws NotFoundError if account not found.
   **/
  static async remove(id) {
    const result = await db.query(
      `DELETE
       FROM accounts
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    const account = result.rows[0];
    if (!account) throw new NotFoundError(`No account with id: ${id}`);

    return { deleted: id };
  }

  /** Add a user to an account.
   *
   * If the account has no users yet, role is forced to 'owner'.
   * Uses upsert: if the user is already in the account, updates their role.
   *
   * Data: { userId, accountId, role }
   *
   * Returns { accountId, userId, role, createdAt }
   **/
  static async addUserToAccount({ userId, accountId, role = 'member' }) {
    const isLinked = await isAccountLinkedToUser(accountId);

    if (!isLinked) {
      role = 'owner';
    }

    try {
      const result = await db.query(
        `INSERT INTO account_users (
            account_id,
            user_id,
            role)
        VALUES ($1, $2, $3)
        ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role
        RETURNING account_id AS "accountId",
                  user_id AS "userId",
                  role,
                  created_at AS "createdAt"`,
        [accountId, userId, role]
      );

      return result.rows[0];
    } catch (err) {
      console.error("Error adding user to account:", err);
      throw err;
    }
  }

  /** Checks if a user is linked to a specific account.
   *  Returns true if linked, false otherwise.
   */
  static async isUserLinkedToAccount(userId, accountId) {
    try {
      const result = await db.query(
        `SELECT user_id
        FROM account_users
        WHERE user_id = $1 AND account_id = $2`,
        [userId, accountId]
      );

      return result.rows.length > 0;
    } catch (err) {
      console.error("Error checking if user is linked to account:", err);
      throw err;
    }
  }

  /** Create a new account and link a user as owner.
   *
   * Data: { name, userId }
   *
   * Returns the created account.
   */
  static async linkNewUserToAccount({ name, userId }) {
    try {
      const account = await this.create({ name, ownerUserId: userId });
      await this.addUserToAccount({ userId, accountId: account.id, role: 'owner' });
      return account;
    } catch (err) {
      console.error("Error linking new user to account:", err);
      throw err;
    }
  }

  /** Remove a user from an account.
   *
   * Data: { userId, accountId }
   */
  static async removeUserFromAccount({ userId, accountId }) {
    try {
      const result = await db.query(
        `DELETE FROM account_users
        WHERE user_id = $1 AND account_id = $2`,
        [userId, accountId]
      );
      return result.rows[0];
    } catch (err) {
      console.error("Error removing user from account:", err);
      throw err;
    }
  }
}

module.exports = Account;
