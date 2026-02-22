"use strict";

/**
 * SQL Helper
 *
 * Builds parameterized SET clauses for partial updates. Maps JS camelCase
 * keys to snake_case column names. Returns setCols and values for use in
 * UPDATE queries.
 *
 * Exports: sqlForPartialUpdate
 */

const { BadRequestError } = require("../expressError");

/** Given parameters of an object with updated data and an object to map JS keys
 * to the table column names, generates SQL query components to perform updates
 * in the database.
 *
 * Returns => {
      setCols: '"first_name"=$1, "age"=$2',
      values: ["Aliya", 32]
    }
*/
function sqlForPartialUpdate(dataToUpdate, jsToSql) {
  const keys = Object.keys(dataToUpdate);
  if (keys.length === 0) throw new BadRequestError("No data to update");

  // {firstName: 'Aliya', age: 32} => ['"first_name"=$1', '"age"=$2']
  const cols = keys.map((colName, idx) =>
    `"${jsToSql[colName] || colName}"=$${idx + 1}`,
  );

  return {
    setCols: cols.join(", "),
    values: Object.values(dataToUpdate),
  };
}

module.exports = { sqlForPartialUpdate };