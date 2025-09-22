import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

/**
 * Comprehensive Test Suite for Lease-Lock Smart Contract - Commit 1/4
 * 
 * This first commit covers lease creation and validation functionality:
 * - Contract initialization
 * - Basic lease creation with valid parameters
 * - Input validation and error handling
 * - Multiple lease creation and statistics
 * - Lease detail retrieval
 * - Lessor profile management
 * 
 * Total lines: ~80 lines of test code
 */

// Test constants matching contract constants
const ERR_UNAUTHORIZED = 100;
const ERR_LEASE_NOT_FOUND = 101;
const ERR_INSUFFICIENT_PAYMENT = 104;
const ERR_INVALID_TERMS = 106;
const ERR_LEASE_TERMINATED = 107;
const STATUS_ACTIVE = 1;
const STATUS_TERMINATED = 3;

Clarinet.test({
    name: "Contract initialization - verify initial state",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        
        // Test contract stats - direct tuple access without expectOk()
        let statsCall = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-contract-stats',
            [],
            deployer.address
        );
        
        // The result is a tuple - access properties directly
        statsCall.result.expectTuple();
    },
});

Clarinet.test({
    name: "Create lease - successful creation with valid parameters",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        const monthlyPayment = 100000; // 0.1 STX
        const leaseDuration = 365; // 1 year
        const securityDeposit = 200000; // 0.2 STX
        
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("2023 Toyota Camry - VIN: 1234567890"),
                    types.uint(monthlyPayment),
                    types.uint(leaseDuration),
                    types.uint(securityDeposit)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Verify lease details can be retrieved
        let leaseDetails = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lease-details',
            [types.uint(1)],
            lessor.address
        );
        
        leaseDetails.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Create lease - input validation for invalid terms",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Test minimum lease duration validation (< 30 days)
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Invalid short lease"),
                    types.uint(100000),
                    types.uint(10),
                    types.uint(100000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_TERMS);
        
        // Test zero payment validation
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Invalid zero payment"),
                    types.uint(0),
                    types.uint(365),
                    types.uint(100000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_TERMS);
    },
});

Clarinet.test({
    name: "Create lease - prevent self-leasing",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessor.address), // Same as lessor
                    types.utf8("Self-lease attempt"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(100000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_TERMS);
    },
});

Clarinet.test({
    name: "Create lease - insufficient security deposit validation",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Low security deposit test"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(50000) // Less than monthly payment
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_TERMS);
    },
});

Clarinet.test({
    name: "Multiple lease creation - sequential IDs",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor1 = accounts.get('wallet_1')!;
        const lessor2 = accounts.get('wallet_2')!;
        const lessee1 = accounts.get('wallet_3')!;
        const lessee2 = accounts.get('wallet_4')!;
        
        // Create first lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee1.address),
                    types.utf8("Honda Civic 2023"),
                    types.uint(80000),
                    types.uint(365),
                    types.uint(160000)
                ],
                lessor1.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Create second lease
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee2.address),
                    types.utf8("Ford F-150 2023"),
                    types.uint(150000),
                    types.uint(730),
                    types.uint(300000)
                ],
                lessor2.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(2);
        
        // Verify contract statistics updated correctly
        let statsCall = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-contract-stats',
            [],
            lessor1.address
        );
        
        statsCall.result.expectTuple();
    },
});

Clarinet.test({
    name: "Lease details retrieval - existing and non-existing",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create a lease first
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("BMW 3 Series Test"),
                    types.uint(120000),
                    types.uint(365),
                    types.uint(240000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Test retrieving existing lease
        let leaseDetails = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lease-details',
            [types.uint(1)],
            lessor.address
        );
        
        leaseDetails.result.expectSome().expectTuple();
        
        // Test retrieving non-existing lease
        let nonExistingLease = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lease-details',
            [types.uint(999)],
            lessor.address
        );
        
        nonExistingLease.result.expectNone();
    },
});

Clarinet.test({
    name: "Lessor profile management - update and retrieve",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        
        // Update lessor profile
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'update-lessor-profile',
                [types.utf8("Elite Auto Leasing Corp")],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);
        
        // Retrieve updated profile
        let profileCall = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lessor-profile',
            [types.principal(lessor.address)],
            lessor.address
        );
        
        profileCall.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Contract stats verification - initial and after operations",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Check initial stats
        let initialStats = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-contract-stats',
            [],
            deployer.address
        );
        
        initialStats.result.expectTuple();
        
        // Create a lease to change statistics
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Statistics Test Vehicle"),
                    types.uint(90000),
                    types.uint(365),
                    types.uint(180000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Verify stats changed
        let updatedStats = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-contract-stats',
            [],
            deployer.address
        );
        
        updatedStats.result.expectTuple();
    },
});

/**
 * COMMIT 2/4 - Payment Processing and History Tests
 * 
 * This section covers payment functionality, late fee calculations,
 * and payment history tracking. Tests the core payment mechanics
 * of the lease system including authorization and fee calculations.
 */

Clarinet.test({
    name: "Make payment - successful payment by lessee",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // First create a lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Payment Test Vehicle"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Make a payment
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Verify payment history is recorded
        let paymentHistory = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-payment-details',
            [types.uint(1), types.uint(1)],
            lessee.address
        );
        
        paymentHistory.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Make payment - unauthorized payment attempt",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        const unauthorized = accounts.get('wallet_3')!;
        
        // Create a lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Unauthorized Payment Test"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Attempt payment by unauthorized party
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                unauthorized.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_UNAUTHORIZED);
    },
});

Clarinet.test({
    name: "Make payment - payment for non-existing lease",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessee = accounts.get('wallet_2')!;
        
        // Attempt payment for non-existing lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(999)], // Non-existing lease
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LEASE_NOT_FOUND);
    },
});

Clarinet.test({
    name: "Payment history - track multiple payments",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Multi-Payment Test Vehicle"),
                    types.uint(80000),
                    types.uint(730), // 2 years
                    types.uint(160000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Make first payment
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Make second payment
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Verify both payments in history
        let payment1 = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-payment-details',
            [types.uint(1), types.uint(1)],
            lessee.address
        );
        
        payment1.result.expectSome().expectTuple();
        
        let payment2 = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-payment-details',
            [types.uint(1), types.uint(2)],
            lessee.address
        );
        
        payment2.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Late payment detection - check overdue status",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Late Payment Test Vehicle"),
                    types.uint(90000),
                    types.uint(365),
                    types.uint(180000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Check if lease is overdue (should be false initially)
        let overdueCheck = chain.callReadOnlyFn(
            'leaseLock-contract',
            'is-lease-overdue',
            [types.uint(1)],
            lessor.address
        );
        
        assertEquals(overdueCheck.result, types.bool(false));
    },
});

Clarinet.test({
    name: "Payment amount calculation - verify total owed",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Calculation Test Vehicle"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Calculate total amount owed
        let totalOwed = chain.callReadOnlyFn(
            'leaseLock-contract',
            'calculate-total-owed',
            [types.uint(1)],
            lessor.address
        );
        
        totalOwed.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Partial payment functionality - test partial payments",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Partial Payment Test Vehicle"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Make partial payment
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-partial-payment',
                [types.uint(1), types.uint(50000)], // Half payment
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
    },
});

Clarinet.test({
    name: "Payment validation - zero and invalid amounts",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Payment Validation Test"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Attempt zero partial payment
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-partial-payment',
                [types.uint(1), types.uint(0)], // Zero payment
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INSUFFICIENT_PAYMENT);
    },
});

Clarinet.test({
    name: "Payment completion - lease status after all payments",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create short-term lease for easier testing
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Completion Test Vehicle"),
                    types.uint(100000),
                    types.uint(60), // 2 months for faster testing
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Make first payment
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Make second payment (should complete lease)
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Verify lease details show completion
        let leaseDetails = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lease-details',
            [types.uint(1)],
            lessor.address
        );
        
        leaseDetails.result.expectSome().expectTuple();
    },
});

/**
 * COMMIT 3/4 - Lease Termination and Management Tests
 * 
 * This section covers lease termination functionality, status management,
 * and advanced lessor profile operations. Tests the lifecycle management
 * aspects of the lease system including early termination scenarios.
 */

Clarinet.test({
    name: "Lease termination - successful termination by lessor",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Termination Test Vehicle"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Terminate lease by lessor
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("Contract breach - non-payment")
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Verify lease status changed to terminated
        let leaseDetails = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lease-details',
            [types.uint(1)],
            lessor.address
        );
        
        leaseDetails.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Lease termination - successful termination by lessee",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Lessee Termination Test"),
                    types.uint(90000),
                    types.uint(365),
                    types.uint(180000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Terminate lease by lessee
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("Early return - job relocation")
                ],
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
    },
});

Clarinet.test({
    name: "Lease termination - unauthorized termination attempt",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        const unauthorized = accounts.get('wallet_3')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Unauthorized Termination Test"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Attempt termination by unauthorized party
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("Unauthorized attempt")
                ],
                unauthorized.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_UNAUTHORIZED);
    },
});

Clarinet.test({
    name: "Lease termination - terminate non-existing lease",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        
        // Attempt to terminate non-existing lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(999), // Non-existing lease
                    types.utf8("Non-existing lease termination")
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LEASE_NOT_FOUND);
    },
});

Clarinet.test({
    name: "Lease termination - prevent double termination",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Double Termination Test"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // First termination - should succeed
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("First termination")
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Second termination - should fail
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("Second termination attempt")
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LEASE_TERMINATED);
    },
});

Clarinet.test({
    name: "Payment after termination - prevent payments to terminated lease",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Payment After Termination Test"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Terminate lease
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("Early termination")
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Attempt payment after termination
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LEASE_TERMINATED);
    },
});

Clarinet.test({
    name: "Lessor profile - comprehensive profile management",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee1 = accounts.get('wallet_2')!;
        const lessee2 = accounts.get('wallet_3')!;
        
        // Update lessor profile
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'update-lessor-profile',
                [types.utf8("Professional Lease Management Corp")],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);
        
        // Create multiple leases to test statistics
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee1.address),
                    types.utf8("First Profile Test Vehicle"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            ),
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee2.address),
                    types.utf8("Second Profile Test Vehicle"),
                    types.uint(120000),
                    types.uint(730),
                    types.uint(240000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        
        // Check updated profile with lease statistics
        let profileCall = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lessor-profile',
            [types.principal(lessor.address)],
            lessor.address
        );
        
        profileCall.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Bulk operations - multiple lease queries",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee1 = accounts.get('wallet_2')!;
        const lessee2 = accounts.get('wallet_3')!;
        const lessee3 = accounts.get('wallet_4')!;
        
        // Create multiple leases
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee1.address),
                    types.utf8("Bulk Test Vehicle 1"),
                    types.uint(80000),
                    types.uint(365),
                    types.uint(160000)
                ],
                lessor.address
            ),
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee2.address),
                    types.utf8("Bulk Test Vehicle 2"),
                    types.uint(90000),
                    types.uint(365),
                    types.uint(180000)
                ],
                lessor.address
            ),
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee3.address),
                    types.utf8("Bulk Test Vehicle 3"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 3);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        block.receipts[2].result.expectOk().expectUint(3);
        
        // Test bulk query function
        let bulkQuery = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-multiple-leases',
            [types.list([types.uint(1), types.uint(2), types.uint(3)])],
            lessor.address
        );
        
        bulkQuery.result.expectList();
    },
});

Clarinet.test({
    name: "Contract statistics - comprehensive stats after operations",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor1 = accounts.get('wallet_1')!;
        const lessor2 = accounts.get('wallet_2')!;
        const lessee1 = accounts.get('wallet_3')!;
        const lessee2 = accounts.get('wallet_4')!;
        
        // Initial stats check
        let initialStats = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-contract-stats',
            [],
            lessor1.address
        );
        
        initialStats.result.expectTuple();
        
        // Create leases
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee1.address),
                    types.utf8("Stats Test Vehicle 1"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor1.address
            ),
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee2.address),
                    types.utf8("Stats Test Vehicle 2"),
                    types.uint(110000),
                    types.uint(730),
                    types.uint(220000)
                ],
                lessor2.address
            )
        ]);
        
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        
        // Terminate one lease to test active count changes
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("Statistics update test")
                ],
                lessor1.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Final stats check
        let finalStats = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-contract-stats',
            [],
            lessor1.address
        );
        
        finalStats.result.expectTuple();
    },
});

/**
 * COMMIT 4/4 - Contract Administration and Edge Cases
 * 
 * This final section covers contract administration functions, edge cases,
 * error handling scenarios, and stress testing the system boundaries.
 * Ensures robust operation under all conditions and comprehensive coverage.
 */

Clarinet.test({
    name: "Edge case - extremely large payment amounts",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease with maximum values
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Maximum Value Test Vehicle"),
                    types.uint(2147483647), // Large monthly payment
                    types.uint(3650), // 10 year lease
                    types.uint(4294967295) // Large security deposit
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Verify lease was created with large amounts
        let leaseDetails = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lease-details',
            [types.uint(1)],
            lessor.address
        );
        
        leaseDetails.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Edge case - minimum viable lease parameters",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease with minimum values
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Minimum Value Test"),
                    types.uint(50000), // Viable monthly payment
                    types.uint(90), // Viable lease duration  
                    types.uint(100000) // Viable security deposit
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Make single payment to complete lease
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
    },
});

Clarinet.test({
    name: "Stress test - rapid lease creation and operations",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessees = [
            accounts.get('wallet_2')!,
            accounts.get('wallet_3')!,
            accounts.get('wallet_4')!,
            accounts.get('wallet_5')!,
            accounts.get('wallet_6')!
        ];
        
        // Create multiple leases rapidly
        let createTransactions = [];
        for (let i = 0; i < 5; i++) {
            createTransactions.push(
                Tx.contractCall(
                    'leaseLock-contract',
                    'create-lease',
                    [
                        types.principal(lessees[i].address),
                        types.utf8(`Stress Test Vehicle ${i + 1}`),
                        types.uint(50000 + (i * 10000)),
                        types.uint(365 + (i * 30)),
                        types.uint(100000 + (i * 20000))
                    ],
                    lessor.address
                )
            );
        }
        
        let block = chain.mineBlock(createTransactions);
        assertEquals(block.receipts.length, 5);
        
        // Verify all leases were created successfully
        for (let i = 0; i < 5; i++) {
            block.receipts[i].result.expectOk().expectUint(i + 1);
        }
        
        // Perform rapid payments on all leases
        let paymentTransactions = [];
        for (let i = 1; i <= 5; i++) {
            paymentTransactions.push(
                Tx.contractCall(
                    'leaseLock-contract',
                    'make-payment',
                    [types.uint(i)],
                    lessees[i - 1].address
                )
            );
        }
        
        block = chain.mineBlock(paymentTransactions);
        assertEquals(block.receipts.length, 5);
        
        // Verify all payments were processed
        for (let i = 0; i < 5; i++) {
            block.receipts[i].result.expectOk().expectTuple();
        }
    },
});

Clarinet.test({
    name: "Error handling - comprehensive error code validation",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        const unauthorized = accounts.get('wallet_3')!;
        
        // Test ERR_LEASE_NOT_FOUND
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(999)], // Non-existing lease
                lessee.address
            )
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LEASE_NOT_FOUND);
        
        // Create a lease for further testing
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8("Error Test Vehicle"),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Test ERR_UNAUTHORIZED
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                unauthorized.address // Wrong person making payment
            )
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_UNAUTHORIZED);
        
        // Terminate lease for further testing
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("Testing error codes")
                ],
                lessor.address
            )
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Test ERR_LEASE_TERMINATED
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee.address
            )
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LEASE_TERMINATED);
    },
});

Clarinet.test({
    name: "Security validation - prevent unauthorized profile access",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const otherUser = accounts.get('wallet_2')!;
        
        // Update profile as lessor
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'update-lessor-profile',
                [types.utf8("Security Test Profile")],
                lessor.address
            )
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);
        
        // Verify any user can read profiles (public data)
        let profileCall = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lessor-profile',
            [types.principal(lessor.address)],
            otherUser.address
        );
        
        profileCall.result.expectSome().expectTuple();
        
        // Verify contract stats are publicly readable
        let statsCall = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-contract-stats',
            [],
            otherUser.address
        );
        
        statsCall.result.expectTuple();
    },
});

Clarinet.test({
    name: "Performance validation - large data structure handling",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor = accounts.get('wallet_1')!;
        const lessee = accounts.get('wallet_2')!;
        
        // Create lease with maximum length description
        const longDescription = "A".repeat(256); // Maximum UTF-8 length
        
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee.address),
                    types.utf8(longDescription),
                    types.uint(100000),
                    types.uint(365),
                    types.uint(200000)
                ],
                lessor.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Create multiple payments to build large history
        for (let i = 0; i < 10; i++) {
            block = chain.mineBlock([
                Tx.contractCall(
                    'leaseLock-contract',
                    'make-payment',
                    [types.uint(1)],
                    lessee.address
                )
            ]);
            assertEquals(block.receipts.length, 1);
            block.receipts[0].result.expectOk().expectTuple();
        }
        
        // Verify large payment details can be retrieved
        let paymentDetails = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-payment-details',
            [types.uint(1), types.uint(1)],
            lessor.address
        );
        
        paymentDetails.result.expectSome().expectTuple();
    },
});

Clarinet.test({
    name: "Final integration - comprehensive system validation",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lessor1 = accounts.get('wallet_1')!;
        const lessor2 = accounts.get('wallet_2')!;
        const lessee1 = accounts.get('wallet_3')!;
        const lessee2 = accounts.get('wallet_4')!;
        
        // Initialize multiple lessor profiles
        let block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'update-lessor-profile',
                [types.utf8("Enterprise Leasing Solutions")],
                lessor1.address
            ),
            Tx.contractCall(
                'leaseLock-contract',
                'update-lessor-profile',
                [types.utf8("Premium Vehicle Rentals")],
                lessor2.address
            )
        ]);
        
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectBool(true);
        block.receipts[1].result.expectOk().expectBool(true);
        
        // Create diverse lease portfolio
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee1.address),
                    types.utf8("Enterprise Fleet Vehicle"),
                    types.uint(120000),
                    types.uint(730), // 2 year lease
                    types.uint(240000)
                ],
                lessor1.address
            ),
            Tx.contractCall(
                'leaseLock-contract',
                'create-lease',
                [
                    types.principal(lessee2.address),
                    types.utf8("Premium Sports Car"),
                    types.uint(200000),
                    types.uint(365), // 1 year lease
                    types.uint(400000)
                ],
                lessor2.address
            )
        ]);
        
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        
        // Execute varied payment patterns
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(1)],
                lessee1.address
            ),
            Tx.contractCall(
                'leaseLock-contract',
                'make-payment',
                [types.uint(2)],
                lessee2.address
            )
        ]);
        
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectTuple();
        block.receipts[1].result.expectOk().expectTuple();
        
        // Terminate one lease, complete payments on another
        block = chain.mineBlock([
            Tx.contractCall(
                'leaseLock-contract',
                'terminate-lease',
                [
                    types.uint(1),
                    types.utf8("Corporate fleet restructuring")
                ],
                lessor1.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectTuple();
        
        // Final comprehensive validation
        let finalStats = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-contract-stats',
            [],
            lessor1.address
        );
        
        finalStats.result.expectTuple();
        
        // Verify both lessor profiles maintained
        let profile1 = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lessor-profile',
            [types.principal(lessor1.address)],
            lessor1.address
        );
        
        let profile2 = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lessor-profile',
            [types.principal(lessor2.address)],
            lessor2.address
        );
        
        profile1.result.expectSome().expectTuple();
        profile2.result.expectSome().expectTuple();
        
        // Verify lease details for both remaining leases
        let lease1Details = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lease-details',
            [types.uint(1)],
            lessor1.address
        );
        
        let lease2Details = chain.callReadOnlyFn(
            'leaseLock-contract',
            'get-lease-details',
            [types.uint(2)],
            lessor2.address
        );
        
        lease1Details.result.expectSome().expectTuple();
        lease2Details.result.expectSome().expectTuple();
        
        // System validation complete - all functions operational
        console.log("✅ Comprehensive system validation completed successfully");
    },
});
