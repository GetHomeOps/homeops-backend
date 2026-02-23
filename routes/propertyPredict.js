"use strict";

const express = require("express");
const { ensureLoggedIn } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");

const router = new express.Router();

const ATTOM_API_KEY = process.env.ATTOM_API_KEY;
const ATTOM_BASE_URL = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

/**
 * Map the ATTOM property/detail response into the flat field schema
 * the frontend expects.
 */
function mapAttomToFields(prop) {
  const summary = prop.summary ?? {};
  const building = prop.building ?? {};
  const lot = prop.lot ?? {};
  const rooms = building.rooms ?? {};
  const size = building.size ?? {};
  const interior = building.interior ?? {};
  const construction = building.construction ?? {};
  const parking = building.parking ?? {};
  const area = prop.area ?? {};
  const assessment = prop.assessment ?? {};
  const market = assessment.market ?? {};

  const propTypeMap = {
    SFR: "Single Family",
    CONDO: "Condo",
    TOWNHOUSE: "Townhouse",
    APARTMENT: "Multi-Family",
    MOBILE: "Mobile Home",
    COOP: "Co-op",
  };

  const rawType = summary.proptype ?? "";
  const propertyType =
    propTypeMap[rawType.toUpperCase()] || summary.propclass || rawType || "";

  const lotAcres = lot.lotsize1;
  const lotSqFt = lot.lotsize2;
  let lotSize = "";
  if (lotAcres != null && lotSqFt != null) {
    lotSize = `${lotAcres} ac / ${Number(lotSqFt).toLocaleString()} sf`;
  } else if (lotAcres != null) {
    lotSize = `${lotAcres} ac`;
  } else if (lotSqFt != null) {
    lotSize = `${Number(lotSqFt).toLocaleString()} sf`;
  }

  const prkgSpaces = parseInt(parking.prkgSpaces, 10) || null;
  const prkgType = parking.prkgType ?? "";
  let parkingType = prkgType;
  if (prkgType && prkgSpaces) {
    parkingType = `${prkgType} (${prkgSpaces} spaces)`;
  }
  const garageSqFt = parking.garageSqFt ?? parking.gaession ?? null;

  const bsmtType = (interior.bsmttype ?? "").replace(/_/g, " ");
  const bsmtSize = interior.bsmtsize;
  let basement = bsmtType
    ? bsmtType.charAt(0).toUpperCase() + bsmtType.slice(1).toLowerCase()
    : "";
  if (basement && bsmtSize) {
    basement = `${basement} (${Number(bsmtSize).toLocaleString()} sf)`;
  }

  return {
    propertyType,
    subType: summary.propsubtype ?? "",
    roofType: construction.rooftype ?? "",
    yearBuilt: summary.yearbuilt ?? null,
    effectiveYearBuilt: summary.effyearbuilt ?? null,
    effectiveYearBuiltSource: summary.effyearbuilt ? "Public Records" : "",
    sqFtTotal: size.universalsize ?? size.bldgsize ?? null,
    sqFtFinished: size.livingsize ?? null,
    sqFtUnfinished: bsmtSize && bsmtType?.toLowerCase()?.includes("unfinished")
      ? bsmtSize
      : null,
    garageSqFt: garageSqFt ?? null,
    totalDwellingSqFt: size.grosssize ?? size.grosssizeadjusted ?? null,
    lotSize,
    bedCount: rooms.beds ?? null,
    bathCount: rooms.bathstotal ?? null,
    fullBaths: rooms.bathsfull ?? null,
    threeQuarterBaths: rooms.bathsthreequarter ?? null,
    halfBaths: rooms.bathshalf ?? null,
    numberOfShowers: null,
    numberOfBathtubs: null,
    fireplaces: interior.fplccount ?? null,
    fireplaceTypes: interior.fplctype ?? "",
    basement,
    parkingType,
    totalCoveredParking: prkgSpaces,
    totalUncoveredParking: null,
    schoolDistrict: area.munname ?? "",
    elementarySchool: "",
    juniorHighSchool: "",
    seniorHighSchool: "",
    estimatedValue: market.mktttlvalue ?? null,
    county: area.countyname ?? "",
  };
}

/** POST /property-details — Look up property details from ATTOM public records. */
router.post("/property-details", ensureLoggedIn, async function (req, res, next) {
  try {
    if (!ATTOM_API_KEY) {
      throw new BadRequestError("ATTOM API key is not configured");
    }

    const { address, addressLine1, city, state, zip } = req.body ?? {};

    const streetAddress = (addressLine1 || address || "").trim();
    if (!streetAddress) {
      throw new BadRequestError("Street address is required (address or addressLine1)");
    }

    let cityStateZip = "";
    if (city && state) {
      cityStateZip = zip ? `${city}, ${state} ${zip}` : `${city}, ${state}`;
    } else if (zip) {
      cityStateZip = zip;
    }
    if (!cityStateZip) {
      throw new BadRequestError("City/State or ZIP is required");
    }

    const params = new URLSearchParams({
      address1: streetAddress,
      address2: cityStateZip,
    });

    const url = `${ATTOM_BASE_URL}/property/detail?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        apikey: ATTOM_API_KEY,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("ATTOM API error:", response.status, errorBody);

      if (response.status === 404 || response.status === 204) {
        throw new BadRequestError(
          "No property found at that address. Please verify the address and try again."
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new BadRequestError("ATTOM API authentication failed. Please contact support.");
      }
      if (response.status === 429) {
        throw new BadRequestError("ATTOM API rate limit reached. Please try again in a few minutes.");
      }
      throw new BadRequestError(`Property lookup failed (status ${response.status}). Please try again.`);
    }

    const data = await response.json();
    const properties = data.property;

    if (!properties || properties.length === 0) {
      throw new BadRequestError(
        "No property records found at that address. Please verify the address and try again."
      );
    }

    const prediction = mapAttomToFields(properties[0]);

    return res.json({
      prediction,
      source: "attom",
    });
  } catch (err) {
    if (err instanceof BadRequestError) return next(err);
    console.error("ATTOM property lookup error:", err);
    return next(new BadRequestError("Failed to look up property. Please try again."));
  }
});

module.exports = router;
