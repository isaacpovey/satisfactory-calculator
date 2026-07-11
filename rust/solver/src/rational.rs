//! Exact rational arithmetic helpers mirroring `src/lib/solver/exact/rational.ts`.

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, Signed, Zero};

/// Parses the same value syntax as the TypeScript `Rational.parse`:
/// `a/b` fractions, decimal numbers, and scientific notation.
pub fn parse_rational(value: &str) -> Result<BigRational, String> {
    let text = value.trim();

    if let Some((numerator, denominator)) = text.split_once('/') {
        let numerator: BigInt = numerator
            .trim()
            .parse()
            .map_err(|_| format!("Invalid rational value: \"{value}\""))?;
        let denominator: BigInt = denominator
            .trim()
            .parse()
            .map_err(|_| format!("Invalid rational value: \"{value}\""))?;
        if denominator.is_zero() {
            return Err("Rational denominator cannot be zero".to_string());
        }
        return Ok(BigRational::new(numerator, denominator));
    }

    let (mantissa, exponent_text) = match text.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, exponent),
        None => (text, "0"),
    };
    let exponent: i64 = exponent_text
        .parse()
        .map_err(|_| format!("Invalid rational value: \"{value}\""))?;

    let (sign, digits_text) = match mantissa.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, mantissa.strip_prefix('+').unwrap_or(mantissa)),
    };
    let (integer_digits, fractional_digits) = match digits_text.split_once('.') {
        Some((integer, fraction)) => (integer, fraction),
        None => (digits_text, ""),
    };
    if integer_digits.is_empty() && fractional_digits.is_empty() {
        return Err(format!("Invalid rational value: \"{value}\""));
    }
    if !integer_digits.chars().all(|c| c.is_ascii_digit())
        || !fractional_digits.chars().all(|c| c.is_ascii_digit())
    {
        return Err(format!("Invalid rational value: \"{value}\""));
    }

    let mut digits = String::with_capacity(integer_digits.len() + fractional_digits.len());
    digits.push_str(integer_digits);
    digits.push_str(fractional_digits);
    let digits: BigInt = if digits.is_empty() {
        BigInt::zero()
    } else {
        digits
            .parse()
            .map_err(|_| format!("Invalid rational value: \"{value}\""))?
    };
    let digits = digits * BigInt::from(sign);

    let scale = fractional_digits.len() as i64 - exponent;
    let ten = BigInt::from(10);
    if scale >= 0 {
        Ok(BigRational::new(digits, ten.pow(scale as u32)))
    } else {
        Ok(BigRational::from_integer(digits * ten.pow((-scale) as u32)))
    }
}

/// Formats a rational as `n` or `n/d` (matching `Rational.toFractionString`).
pub fn to_fraction_string(value: &BigRational) -> String {
    if value.denom().is_one() {
        value.numer().to_string()
    } else {
        format!("{}/{}", value.numer(), value.denom())
    }
}

pub fn floor_bigint(value: &BigRational) -> BigInt {
    value.floor().to_integer()
}

pub fn is_integer(value: &BigRational) -> bool {
    value.denom().is_one()
}

pub fn rational_from_u64(value: u64) -> BigRational {
    BigRational::from_integer(BigInt::from(value))
}

pub fn rational_from_bigint(value: BigInt) -> BigRational {
    BigRational::from_integer(value)
}

pub fn abs_bigint(value: &BigInt) -> BigInt {
    value.abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(text: &str) -> String {
        to_fraction_string(&parse_rational(text).unwrap())
    }

    #[test]
    fn parses_fractions_decimals_and_exponents() {
        assert_eq!(parsed("5/2"), "5/2");
        assert_eq!(parsed("-6/4"), "-3/2");
        assert_eq!(parsed("0.25"), "1/4");
        assert_eq!(parsed("-1.5"), "-3/2");
        assert_eq!(parsed("2e3"), "2000");
        assert_eq!(parsed("2.5e-1"), "1/4");
        assert_eq!(parsed("1860"), "1860");
        assert_eq!(parsed(".5"), "1/2");
    }

    #[test]
    fn rejects_invalid_values() {
        assert!(parse_rational("1/0").is_err());
        assert!(parse_rational("abc").is_err());
        assert!(parse_rational("").is_err());
    }
}
