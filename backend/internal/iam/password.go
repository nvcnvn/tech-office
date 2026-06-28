package iam

import (
	"fmt"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

// HashPassword hashes a password using bcrypt with the configured cost factor.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

// VerifyPassword compares a plaintext password against a bcrypt hash.
func VerifyPassword(password, hash string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

// ValidatePassword checks that a password meets complexity requirements:
// - At least 8 characters
// - At most 72 characters (bcrypt limit)
// - At least one uppercase letter
// - At least one lowercase letter
// - At least one digit
func ValidatePassword(password string) error {
	if len(password) < MinPasswordLength {
		return fmt.Errorf("%w: minimum %d characters required", ErrPasswordTooWeak, MinPasswordLength)
	}
	if len(password) > MaxPasswordLength {
		return fmt.Errorf("%w: maximum %d characters allowed", ErrPasswordTooWeak, MaxPasswordLength)
	}

	var hasUpper, hasLower, hasDigit bool
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		}
	}

	if !hasUpper {
		return fmt.Errorf("%w: at least one uppercase letter required", ErrPasswordTooWeak)
	}
	if !hasLower {
		return fmt.Errorf("%w: at least one lowercase letter required", ErrPasswordTooWeak)
	}
	if !hasDigit {
		return fmt.Errorf("%w: at least one digit required", ErrPasswordTooWeak)
	}

	return nil
}
