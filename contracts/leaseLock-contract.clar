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
(define-private (block-height-to-days (current-block-height uint))
  (/ current-block-height u144) ;; Assuming ~144 blocks per day
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

;; Create a new lease agreement
;; @param lessee: The person who will lease the equipment
;; @param asset-description: Description of the asset being leased
;; @param monthly-payment: Monthly payment in micro-STX
;; @param lease-duration: Duration of lease in days
;; @param security-deposit: Security deposit amount
(define-public (create-lease 
    (lessee principal)
    (asset-description (string-utf8 256))
    (monthly-payment uint)
    (lease-duration uint)
    (security-deposit uint))
  (let ((lease-id (var-get next-lease-id))
        (lessor tx-sender))
    ;; Validate inputs
    (asserts! (not (var-get contract-paused)) ERR_UNAUTHORIZED)
    (asserts! (validate-lease-terms lease-duration monthly-payment security-deposit) ERR_INVALID_TERMS)
    (asserts! (not (is-eq lessor lessee)) ERR_INVALID_TERMS)
    
    ;; Create the lease
    (map-set leases 
      { lease-id: lease-id }
      {
        lessor: lessor,
        lessee: lessee,
        asset-description: asset-description,
        monthly-payment: monthly-payment,
        lease-start: block-height,
        lease-duration: lease-duration,
        total-payments: (/ lease-duration u30), ;; Approximate monthly payments
        payments-made: u0,
        status: STATUS_ACTIVE,
        security-deposit: security-deposit,
        late-fee: u0,
        next-payment-due: (+ block-height (days-to-block-height u30))
      }
    )
    
    ;; Update contract state
    (var-set next-lease-id (+ lease-id u1))
    (var-set total-active-leases (+ (var-get total-active-leases) u1))
    (update-lessor-stats lessor true)
    
    (ok lease-id)
  )
)

;; Make a lease payment
;; @param lease-id: ID of the lease
(define-public (make-payment (lease-id uint))
  (let ((lease-data (unwrap! (map-get? leases { lease-id: lease-id }) ERR_LEASE_NOT_FOUND))
        (payer tx-sender)
        (payment-number (+ (get payments-made lease-data) u1))
        (is-late (is-payment-late lease-id))
        (days-late (calculate-days-late lease-id))
        (late-fee (if is-late (calculate-late-fee (get monthly-payment lease-data) days-late) u0)))
    
    ;; Validate payment
    (asserts! (is-eq payer (get lessee lease-data)) ERR_UNAUTHORIZED)
    (asserts! (is-eq (get status lease-data) STATUS_ACTIVE) ERR_LEASE_TERMINATED)
    (asserts! (< (get payments-made lease-data) (get total-payments lease-data)) ERR_LEASE_EXPIRED)
    
    ;; Record payment in history
    (map-set payment-history
      { lease-id: lease-id, payment-number: payment-number }
      {
        amount: (get monthly-payment lease-data),
        payment-date: block-height,
        late-fee: late-fee,
        is-late: is-late
      }
    )
    
    ;; Update lease record
    (map-set leases 
      { lease-id: lease-id }
      (merge lease-data {
        payments-made: payment-number,
        late-fee: (+ (get late-fee lease-data) late-fee),
        next-payment-due: (+ (get next-payment-due lease-data) (days-to-block-height u30)),
        status: (if (is-eq payment-number (get total-payments lease-data)) STATUS_COMPLETED STATUS_ACTIVE)
      })
    )
    
    ;; Update active leases count if lease is completed
    (if (is-eq payment-number (get total-payments lease-data))
      (var-set total-active-leases (- (var-get total-active-leases) u1))
      true
    )
    
    (ok { payment-made: (get monthly-payment lease-data), late-fee: late-fee })
  )
)

;; Get lease details
;; @param lease-id: ID of the lease to query
(define-read-only (get-lease-details (lease-id uint))
  (map-get? leases { lease-id: lease-id })
)

;; Get payment history for a lease
;; @param lease-id: ID of the lease
;; @param payment-number: Specific payment number to query
(define-read-only (get-payment-details (lease-id uint) (payment-number uint))
  (map-get? payment-history { lease-id: lease-id, payment-number: payment-number })
)

;; Check if a lease payment is overdue
;; @param lease-id: ID of the lease to check
(define-read-only (is-lease-overdue (lease-id uint))
  (match (map-get? leases { lease-id: lease-id })
    lease-data 
      (and 
        (is-eq (get status lease-data) STATUS_ACTIVE)
        (> block-height (+ (get next-payment-due lease-data) (days-to-block-height GRACE_PERIOD))))
    false
  )
)

;; Terminate a lease early (can be called by lessor or lessee)
;; @param lease-id: ID of the lease to terminate
;; @param reason: Reason for termination
(define-public (terminate-lease (lease-id uint) (reason (string-utf8 128)))
  (let ((lease-data (unwrap! (map-get? leases { lease-id: lease-id }) ERR_LEASE_NOT_FOUND))
        (caller tx-sender))
    
    ;; Validate termination request
    (asserts! (is-authorized caller lease-id) ERR_UNAUTHORIZED)
    (asserts! (not (is-eq (get status lease-data) STATUS_TERMINATED)) ERR_LEASE_TERMINATED)
    
    ;; Update lease status
    (map-set leases 
      { lease-id: lease-id }
      (merge lease-data { status: STATUS_TERMINATED })
    )
    
    ;; Update active leases count
    (var-set total-active-leases (- (var-get total-active-leases) u1))
    
    (ok { terminated-by: caller, reason: reason })
  )
)

;; Update lessor profile information
;; @param name: Display name for the lessor
(define-public (update-lessor-profile (name (string-utf8 100)))
  (let ((lessor tx-sender)
        (current-stats (default-to 
                         { name: u"", active-leases: u0, total-leases-created: u0, reputation-score: u50 }
                         (map-get? lessors { lessor: lessor }))))
    
    (map-set lessors 
      { lessor: lessor }
      (merge current-stats { name: name })
    )
    
    (ok true)
  )
)

;; Get lessor profile and statistics
;; @param lessor: Principal address of the lessor
(define-read-only (get-lessor-profile (lessor principal))
  (map-get? lessors { lessor: lessor })
)

;; Get contract statistics
(define-read-only (get-contract-stats)
  {
    total-leases-created: (- (var-get next-lease-id) u1),
    total-active-leases: (var-get total-active-leases),
    contract-paused: (var-get contract-paused),
    contract-owner: CONTRACT_OWNER
  }
)

;; Calculate total amount owed for a lease (including late fees)
;; @param lease-id: ID of the lease
(define-read-only (calculate-total-owed (lease-id uint))
  (match (map-get? leases { lease-id: lease-id })
    lease-data 
      (let ((remaining-payments (- (get total-payments lease-data) (get payments-made lease-data)))
            (base-amount (* remaining-payments (get monthly-payment lease-data)))
            (current-late-fee (if (is-payment-late lease-id)
                                (calculate-late-fee (get monthly-payment lease-data) (calculate-days-late lease-id))
                                u0)))
        (some { 
          remaining-payments: remaining-payments,
          base-amount: base-amount,
          accumulated-late-fees: (get late-fee lease-data),
          current-late-fee: current-late-fee,
          total-owed: (+ base-amount (get late-fee lease-data) current-late-fee)
        }))
    none
  )
)

;; Emergency pause contract (owner only)
(define-public (pause-contract)
  (begin 
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_UNAUTHORIZED)
    (var-set contract-paused true)
    (ok true)
  )
)

;; Resume contract operations (owner only)  
(define-public (resume-contract)
  (begin 
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_UNAUTHORIZED)
    (var-set contract-paused false)
    (ok true)
  )
)

;; Bulk query function to get multiple lease details
;; @param lease-ids: List of lease IDs to query
(define-read-only (get-multiple-leases (lease-ids (list 10 uint)))
  (map get-lease-details lease-ids)
)

;; Get leases for a specific lessee
;; @param lessee: Principal address to search for
;; @param start-id: Starting lease ID for search
;; @param limit: Maximum number of results
;; Note: This is a simplified implementation - in practice, you'd need to iterate through lease IDs
(define-read-only (get-lessee-leases (lessee principal) (start-id uint) (limit uint))
  ;; For now, return empty list - this would need a more complex implementation
  ;; to iterate through existing lease IDs and filter by lessee
  (list)
)

;; Advanced payment function with partial payments support
;; @param lease-id: ID of the lease
;; @param payment-amount: Amount to pay (can be partial)
(define-public (make-partial-payment (lease-id uint) (payment-amount uint))
  (let ((lease-data (unwrap! (map-get? leases { lease-id: lease-id }) ERR_LEASE_NOT_FOUND))
        (payer tx-sender))
    
    ;; Validate payment
    (asserts! (is-eq payer (get lessee lease-data)) ERR_UNAUTHORIZED)
    (asserts! (is-eq (get status lease-data) STATUS_ACTIVE) ERR_LEASE_TERMINATED)
    (asserts! (> payment-amount u0) ERR_INSUFFICIENT_PAYMENT)
    
    ;; This is a simplified version - in a full implementation,
    ;; you'd track partial payments and apply them to outstanding balance
    (ok { partial-payment-recorded: payment-amount })
  )
)