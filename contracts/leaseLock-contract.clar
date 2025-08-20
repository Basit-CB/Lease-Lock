;; leaseLock-contract
;; A smart contract for car or equipment leasing with automated payment schedules
;; and penalties for missed deadlines. Provides secure, transparent lease management
;; on the Stacks blockchain with automated enforcement of lease terms.

;; constants
;; Error codes for contract operations
(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_LEASE_NOT_FOUND (err u101))
(define-constant ERR_LEASE_ALREADY_EXISTS (err u102))
(define-constant ERR_PAYMENT_LATE (err u103))
(define-constant ERR_INSUFFICIENT_PAYMENT (err u104))
(define-constant ERR_LEASE_EXPIRED (err u105))
(define-constant ERR_INVALID_TERMS (err u106))
(define-constant ERR_LEASE_TERMINATED (err u107))

;; Contract configuration constants
(define-constant CONTRACT_OWNER tx-sender)
(define-constant PENALTY_RATE u5) ;; 5% penalty rate for late payments
(define-constant GRACE_PERIOD u7) ;; 7 days grace period for payments
(define-constant MIN_LEASE_DURATION u30) ;; Minimum 30 days lease
(define-constant MAX_LEASE_DURATION u36500) ;; Maximum ~100 years lease

;; Status constants for lease states
(define-constant STATUS_ACTIVE u1)
(define-constant STATUS_LATE u2)
(define-constant STATUS_TERMINATED u3)
(define-constant STATUS_COMPLETED u4)

;; data maps and vars
;; Global contract state variables
(define-data-var next-lease-id uint u1)
(define-data-var total-active-leases uint u0)
(define-data-var contract-paused bool false)

;; Main lease storage - maps lease ID to lease details
(define-map leases
  { lease-id: uint }
  {
    lessor: principal,           ;; Equipment owner/lessor
    lessee: principal,           ;; Person leasing the equipment
    asset-description: (string-utf8 256),
    monthly-payment: uint,       ;; Payment amount in micro-STX
    lease-start: uint,           ;; Block height when lease starts
    lease-duration: uint,        ;; Duration in days
    total-payments: uint,        ;; Total number of payments required
    payments-made: uint,         ;; Number of successful payments
    status: uint,                ;; Current lease status
    security-deposit: uint,      ;; Security deposit amount
    late-fee: uint,              ;; Accumulated late fees
    next-payment-due: uint       ;; Block height when next payment is due
  }
)

;; Payment history tracking
(define-map payment-history
  { lease-id: uint, payment-number: uint }
  {
    amount: uint,
    payment-date: uint,          ;; Block height of payment
    late-fee: uint,              ;; Late fee charged for this payment
    is-late: bool                ;; Whether payment was late
  }
)

;; Lessor (equipment owner) profiles
(define-map lessors
  { lessor: principal }
  {
    name: (string-utf8 100),
    active-leases: uint,
    total-leases-created: uint,
    reputation-score: uint       ;; Simple reputation system (0-100)
  }
)

;; private functions
;; Helper function to calculate late fees based on days overdue
(define-private (calculate-late-fee (payment-amount uint) (days-late uint))
  (let ((daily-penalty (/ (* payment-amount PENALTY_RATE) u100)))
    (* daily-penalty days-late)
  )
)

;; Helper function to check if a lease exists
(define-private (lease-exists (lease-id uint))
  (is-some (map-get? leases { lease-id: lease-id }))
)

;; Helper function to get current block height as days (approximation)
(define-private (block-height-to-days (block-height uint))
  (/ block-height u144) ;; Assuming ~144 blocks per day
)

;; Helper function to convert days to block height
(define-private (days-to-block-height (days uint))
  (* days u144)
)

;; Helper function to check if payment is late
(define-private (is-payment-late (lease-id uint))
  (match (map-get? leases { lease-id: lease-id })
    lease-data (> block-height (get next-payment-due lease-data))
    false
  )
)

;; Helper function to calculate days late for a payment
(define-private (calculate-days-late (lease-id uint))
  (match (map-get? leases { lease-id: lease-id })
    lease-data 
      (if (> block-height (get next-payment-due lease-data))
        (block-height-to-days (- block-height (get next-payment-due lease-data)))
        u0)
    u0
  )
)

;; Helper function to update lessor statistics
(define-private (update-lessor-stats (lessor principal) (increment-active bool))
  (let ((current-stats (default-to 
                         { name: u"", active-leases: u0, total-leases-created: u0, reputation-score: u50 }
                         (map-get? lessors { lessor: lessor }))))
    (map-set lessors 
      { lessor: lessor }
      {
        name: (get name current-stats),
        active-leases: (if increment-active 
                        (+ (get active-leases current-stats) u1)
                        (get active-leases current-stats)),
        total-leases-created: (+ (get total-leases-created current-stats) u1),
        reputation-score: (get reputation-score current-stats)
      }
    )
    true
  )
)

;; Helper function to validate lease terms
(define-private (validate-lease-terms (duration uint) (monthly-payment uint) (security-deposit uint))
  (and 
    (>= duration MIN_LEASE_DURATION)
    (<= duration MAX_LEASE_DURATION)
    (> monthly-payment u0)
    (>= security-deposit (* monthly-payment u1)) ;; Security deposit at least 1 month rent
  )
)

;; Helper function to check contract authorization
(define-private (is-authorized (caller principal) (lease-id uint))
  (match (map-get? leases { lease-id: lease-id })
    lease-data (or 
                 (is-eq caller (get lessor lease-data))
                 (is-eq caller (get lessee lease-data))
                 (is-eq caller CONTRACT_OWNER))
    false
  )
)

;; public functions
;;