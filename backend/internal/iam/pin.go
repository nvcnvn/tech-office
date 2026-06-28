package iam

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

// GenerateTemporaryPIN generates a cryptographically random 6-digit numeric PIN.
func GenerateTemporaryPIN() (string, error) {
	max := big.NewInt(1000000) // 0-999999
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", fmt.Errorf("failed to generate random PIN: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// HashPIN hashes a PIN using bcrypt.
func HashPIN(pin string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(pin), PINBcryptCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash PIN: %w", err)
	}
	return string(hash), nil
}

// ComparePINHash compares a plaintext PIN with a bcrypt hash.
func ComparePINHash(hash, pin string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pin))
}

// ValidatePINFormat validates that pin is exactly 6 numeric digits.
func ValidatePINFormat(pin string) error {
	if len(pin) != PINLength {
		return ErrPINTooShort
	}
	for _, r := range pin {
		if !unicode.IsDigit(r) {
			return ErrPINNotNumeric
		}
	}
	return nil
}

// ComparePINWithPersonalData checks if a PIN matches known personal data patterns.
// dob format: "YYYY-MM-DD" or ""; phone: any format or "".
func ComparePINWithPersonalData(pin, dob, phone string) error {
	if dob != "" {
		// Extract digits from DOB: check YYMMDD, DDMMYY, MMDDYY patterns
		dobDigits := extractDigits(dob)
		if len(dobDigits) >= 8 {
			// YYMMDD (last 2 of year + month + day)
			yymmdd := dobDigits[2:4] + dobDigits[4:6] + dobDigits[6:8]
			if pin == yymmdd {
				return ErrPINMatchesDOB
			}
			// DDMMYY
			ddmmyy := dobDigits[6:8] + dobDigits[4:6] + dobDigits[2:4]
			if pin == ddmmyy {
				return ErrPINMatchesDOB
			}
			// MMDDYY
			mmddyy := dobDigits[4:6] + dobDigits[6:8] + dobDigits[2:4]
			if pin == mmddyy {
				return ErrPINMatchesDOB
			}
		}
	}

	if phone != "" {
		phoneDigits := extractDigits(phone)
		if len(phoneDigits) >= 6 {
			// Check last 6 digits of phone number
			last6 := phoneDigits[len(phoneDigits)-6:]
			if pin == last6 {
				return ErrPINMatchesPhone
			}
		}
	}

	return nil
}

func extractDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
