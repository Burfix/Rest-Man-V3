<?php
/**
 * Plugin Name:       Si Cantina Booking Sync
 * Plugin URI:        https://sicantinasociale.co.za
 * Description:       Syncs new bookings from Restaurant Table Bookings (RTB) to the Si Cantina concierge dashboard instantly.
 * Version:           2.3.0
 * Author:            Si Cantina Sociale
 * License:           MIT
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ============================================================
// Admin notice when plugin is not configured
// ============================================================

add_action( 'admin_notices', function () {
    if ( ! current_user_can( 'manage_options' ) ) return;
    $url = get_option( 'sicantina_api_url', '' );
    $key = get_option( 'sicantina_api_key', '' );
    if ( $url && $key ) return; // configured — no notice needed
    $settings_url = admin_url( 'options-general.php?page=sicantina-sync' );
    echo '<div class="notice notice-error"><p>';
    echo '<strong>Si Cantina Booking Sync:</strong> The plugin is active but not configured — bookings will <strong>not</strong> sync to the dashboard. ';
    echo '<a href="' . esc_url( $settings_url ) . '">Configure it now &rarr;</a>';
    echo '</p></div>';
} );

add_action( 'admin_menu', function () {
    add_options_page(
        'Si Cantina Booking Sync',
        'Cantina Booking Sync',
        'manage_options',
        'sicantina-sync',
        'sicantina_settings_page'
    );
} );

add_action( 'admin_init', function () {
    register_setting( 'sicantina_sync', 'sicantina_api_url',       [ 'sanitize_callback' => 'esc_url_raw' ] );
    register_setting( 'sicantina_sync', 'sicantina_api_key',       [ 'sanitize_callback' => 'sanitize_text_field' ] );
    register_setting( 'sicantina_sync', 'sicantina_sync_new_only', [ 'sanitize_callback' => 'absint' ] );
} );

function sicantina_settings_page() { ?>
<div class="wrap">
    <h1>Si Cantina Booking Sync</h1>
    <p>Automatically forwards every new <strong>Restaurant Table Bookings (RTB)</strong> submission to your concierge dashboard the moment a guest books online.</p>
    <form method="post" action="options.php">
        <?php settings_fields( 'sicantina_sync' ); ?>
        <table class="form-table">
            <tr><th scope="row">Dashboard API URL</th><td>
                <input type="url" name="sicantina_api_url"
                    value="<?php echo esc_attr( get_option('sicantina_api_url') ); ?>"
                    class="regular-text"
                    placeholder="https://yourdomain.com/api/bookings/import" />
                <p class="description">Your deployed dashboard URL + <code>/api/bookings/import</code><br>Example: <code>https://sicantina-dashboard.vercel.app/api/bookings/import</code></p>
            </td></tr>
            <tr><th scope="row">API Secret Key</th><td>
                <input type="password" name="sicantina_api_key"
                    value="<?php echo esc_attr( get_option('sicantina_api_key') ); ?>"
                    class="regular-text" />
                <p class="description">Copy <code>IMPORT_API_KEY</code> from your server's <code>.env.local</code>.</p>
            </td></tr>
            <tr><th scope="row">Sync behaviour</th><td>
                <label><input type="checkbox" name="sicantina_sync_new_only" value="1"
                    <?php checked( 1, get_option('sicantina_sync_new_only', 1) ); ?> />
                    Only sync each RTB booking <strong>once</strong> (on first creation)
                </label>
                <p class="description">Recommended — prevents duplicate entries when staff change a booking status in RTB.</p>
            </td></tr>
        </table>
        <?php submit_button( 'Save Settings' ); ?>
    </form>
    <hr>
    <h2>Connection Test</h2>
    <?php
    // ── Bulk sync handler ────────────────────────────────────────────────────
    if ( isset($_GET['sicantina_bulk_sync']) && check_admin_referer('sicantina_bulk_sync') ) :
        $bulk = sicantina_bulk_sync_all();
        if ( $bulk['synced'] > 0 || $bulk['skipped'] > 0 ) :
            echo '<div class="notice notice-success inline"><p>';
            printf( '<strong>Bulk sync complete.</strong> Synced: <strong>%d</strong> | Already synced / skipped: %d | Errors: %d | Total RTB bookings found: %d',
                $bulk['synced'], $bulk['skipped'], $bulk['errors'], $bulk['total'] );
            echo '</p></div>';
        else :
            echo '<div class="notice notice-warning inline"><p>No unsynced bookings found, or an error occurred. Check the log below.</p></div>';
        endif;
    endif;
    ?>

    <hr>
    <h2>&#128260; Bulk Sync Existing Bookings</h2>
    <p>Use this to push bookings that were created in RTB <em>before</em> this plugin was connected to the dashboard. Each booking is only sent once — already-synced bookings are skipped automatically.</p>
    <p><a href="<?php echo esc_url(wp_nonce_url(add_query_arg('sicantina_bulk_sync','1'),'sicantina_bulk_sync')); ?>" class="button button-primary"
        onclick="return confirm('This will sync all unsynced RTB bookings to the dashboard. Continue?');">Sync All Unsynced Bookings Now</a></p>

    <hr>
    <h2>Connection Test</h2>
    <?php if ( isset($_GET['sicantina_test']) && check_admin_referer('sicantina_test') ) :
        $result = sicantina_send_booking([
            'customer_name' => 'Test User',
            'phone_number'  => '+27000000000',
            'booking_date'  => date('Y-m-d', strtotime('+7 days')),
            'booking_time'  => '19:00',
            'guest_count'   => 2,
            'special_notes' => 'Connection test from WordPress plugin.',
        ]);
        if ( is_wp_error($result) ) :
            echo '<div class="notice notice-error inline"><p><strong>Error:</strong> ' . esc_html($result->get_error_message()) . '</p></div>';
        else :
            echo '<div class="notice notice-success inline"><p><strong>Success!</strong> Reservation ID: <code>' . esc_html($result['reservation_id'] ?? 'n/a') . '</code></p></div>';
        endif;
    endif; ?>
    <p><a href="<?php echo esc_url(wp_nonce_url(add_query_arg('sicantina_test','1'),'sicantina_test')); ?>" class="button button-secondary">Send Test Booking</a></p>
    <hr>
    <h2>Recent Sync Log</h2>
    <?php
    $log = get_option('sicantina_sync_log', []);
    if ( empty($log) ) {
        echo '<p class="description">No bookings synced yet.</p>';
    } else {
        echo '<table class="widefat striped"><thead><tr><th>Time</th><th>RTB ID</th><th>Guest</th><th>Date</th><th>Hook</th><th>Result</th></tr></thead><tbody>';
        foreach ( array_reverse($log) as $entry ) {
            $c = $entry['ok'] ? 'green' : 'red';
            printf('<tr><td>%s</td><td>#%s</td><td>%s</td><td>%s</td><td><code style="font-size:10px">%s</code></td><td style="color:%s">%s</td></tr>',
                esc_html($entry['time'] ?? ''), esc_html($entry['rtb_id'] ?? ''),
                esc_html($entry['name'] ?? ''), esc_html($entry['date'] ?? ''),
                esc_html($entry['hook'] ?? '—'), $c,
                esc_html($entry['ok'] ? 'OK — '.($entry['reservation_id']??'') : 'Error: '.($entry['error']??'')));
        }
        echo '</tbody></table>';
        echo '<p><a href="'.esc_url(wp_nonce_url(add_query_arg('sicantina_clear_log','1'),'clear_log')).'" class="button button-small">Clear Log</a></p>';
    }
    if ( isset($_GET['sicantina_clear_log']) && check_admin_referer('clear_log') ) {
        delete_option('sicantina_sync_log');
        wp_redirect(remove_query_arg(['sicantina_clear_log','_wpnonce'])); exit;
    }
    ?>
</div>
<?php }

// ============================================================
// Bulk sync: push all previously-unsynced RTB bookings
// ============================================================

function sicantina_bulk_sync_all(): array {
    // Fetch every RTB booking that hasn't been flagged as synced yet
    $posts = get_posts( [
        'post_type'      => 'rtb-booking',
        'posts_per_page' => -1,
        'post_status'    => [ 'publish', 'confirmed', 'pending', 'closed', 'any' ],
        'meta_query'     => [ [
            'key'     => '_sicantina_synced',
            'compare' => 'NOT EXISTS',
        ] ],
    ] );

    $synced  = 0;
    $skipped = 0;
    $errors  = 0;

    foreach ( $posts as $post ) {
        // Parse booking date/time from RTB meta
        $meta_ts      = get_post_meta( $post->ID, 'rtb-date', true );
        $booking_date = '';
        $booking_time = '';
        if ( $meta_ts ) {
            $ts = is_numeric( $meta_ts ) ? (int) $meta_ts : strtotime( (string) $meta_ts );
            if ( $ts ) {
                $booking_date = date( 'Y-m-d', $ts );
                $booking_time = date( 'H:i',   $ts );
            }
        }

        if ( ! $booking_date || ! $booking_time ) {
            $skipped++;
            error_log( "[SiCantina] Bulk sync: skipping RTB #{$post->ID} — could not parse date." );
            continue;
        }

        $before_count = count( get_option( 'sicantina_sync_log', [] ) );

        sicantina_process_booking( $post->ID, [
            'name'         => get_post_meta( $post->ID, 'rtb-name',    true ),
            'email'        => get_post_meta( $post->ID, 'rtb-email',   true ),
            'phone'        => get_post_meta( $post->ID, 'rtb-phone',   true ),
            'party'        => get_post_meta( $post->ID, 'rtb-party',   true ),
            'booking_date' => $booking_date,
            'booking_time' => $booking_time,
            'notes'        => get_post_meta( $post->ID, 'rtb-message', true ),
        ], 'bulk_sync' );

        if ( get_post_meta( $post->ID, '_sicantina_synced', true ) ) {
            $synced++;
        } else {
            // Log grew (error entry added) or nothing happened
            $errors++;
        }
    }

    return [
        'total'   => count( $posts ),
        'synced'  => $synced,
        'skipped' => $skipped,
        'errors'  => $errors,
    ];
}

// ============================================================
// Core: send booking to dashboard API
// ============================================================

function sicantina_send_booking( array $data ) {
    $url = get_option( 'sicantina_api_url', '' );
    $key = get_option( 'sicantina_api_key', '' );

    if ( empty($url) || empty($key) ) {
        return new WP_Error( 'not_configured', 'Si Cantina Sync: API URL or Key not set. Go to Settings -> Cantina Booking Sync.' );
    }

    $response = wp_remote_post( $url, [
        'timeout'     => 20,
        'headers'     => [
            'Content-Type'  => 'application/json',
            'Authorization' => 'Bearer ' . $key,
        ],
        'body'        => wp_json_encode( $data ),
        'data_format' => 'body',
    ] );

    if ( is_wp_error( $response ) ) {
        return $response;
    }

    $code = wp_remote_retrieve_response_code( $response );
    $body = json_decode( wp_remote_retrieve_body( $response ), true );

    if ( $code < 200 || $code >= 300 ) {
        $msg = isset($body['error']) ? $body['error'] : "HTTP $code";
        return new WP_Error( 'api_error', $msg );
    }

    return $body;
}

// ============================================================
// Shared booking processor — called by all hooks below
// ============================================================

/**
 * Normalise and send a booking to the dashboard.
 *
 * @param int    $post_id      RTB booking post ID.
 * @param array  $raw          Associative array of raw data extracted by the caller.
 * @param string $hook_source  Label used in error_log for debugging.
 */
function sicantina_process_booking( int $post_id, array $raw, string $hook_source = 'hook' ): void {

    // ── Guard: deduplicate within the same PHP process (prevents double-send
    //           when multiple hooks fire for the same save operation) ──────────
    static $sent_ids = [];
    if ( in_array( $post_id, $sent_ids, true ) ) return;

    // ── Guard: skip if already synced and "new only" mode is on ─────────────
    if ( (int) get_option( 'sicantina_sync_new_only', 1 ) &&
         get_post_meta( $post_id, '_sicantina_synced', true ) ) {
        error_log( "[SiCantina] Skipped RTB #{$post_id} via {$hook_source} — already synced." );
        return;
    }

    // ── Phone normalisation ──────────────────────────────────────────────────
    $phone = preg_replace( '/\s+/', '', (string) ( $raw['phone'] ?? '' ) );
    if ( preg_match( '/^0[6-8][0-9]{8}$/', $phone ) ) {
        $phone = '+27' . substr( $phone, 1 );
    }
    if ( empty( $phone ) ) $phone = 'website-no-phone';

    $data = [
        'customer_name' => sanitize_text_field( $raw['name'] ?? '' ),
        'phone_number'  => $phone,
        'booking_date'  => $raw['booking_date'] ?? '',
        'booking_time'  => $raw['booking_time'] ?? '',
        'guest_count'   => max( 1, (int) ( $raw['party'] ?? 1 ) ),
    ];
    if ( ! empty( $raw['email'] ) ) $data['customer_email']  = sanitize_email( $raw['email'] );
    if ( ! empty( $raw['notes'] ) ) $data['special_notes']   = sanitize_textarea_field( $raw['notes'] );

    if ( ! $data['customer_name'] || ! $data['booking_date'] || ! $data['booking_time'] ) {
        error_log( "[SiCantina] Skipped RTB #{$post_id} via {$hook_source} — missing required fields (name/date/time). Raw: " . wp_json_encode( $raw ) );
        return;
    }

    // Mark as being processed before the remote call so a concurrent hook can't slip through
    $sent_ids[] = $post_id;

    // ── Send ─────────────────────────────────────────────────────────────────
    $result = sicantina_send_booking( $data );

    // ── Log ──────────────────────────────────────────────────────────────────
    $log   = get_option( 'sicantina_sync_log', [] );
    $entry = [
        'time'   => current_time( 'Y-m-d H:i:s' ),
        'rtb_id' => $post_id,
        'name'   => $data['customer_name'],
        'date'   => $data['booking_date'],
        'hook'   => $hook_source,
    ];
    if ( is_wp_error( $result ) ) {
        $entry['ok']    = false;
        $entry['error'] = $result->get_error_message();
        error_log( "[SiCantina] Sync error RTB #{$post_id} via {$hook_source}: " . $result->get_error_message() );
    } else {
        $entry['ok']             = true;
        $entry['reservation_id'] = $result['reservation_id'] ?? '';
        update_post_meta( $post_id, '_sicantina_synced',         1 );
        update_post_meta( $post_id, '_sicantina_reservation_id', $entry['reservation_id'] );
        error_log( "[SiCantina] Synced RTB #{$post_id} via {$hook_source} → reservation " . $entry['reservation_id'] );
    }
    $log[] = $entry;
    if ( count( $log ) > 50 ) $log = array_slice( $log, -50 );
    update_option( 'sicantina_sync_log', $log );
}

// ============================================================
// Hook 1: rtb_booking_post_save  (RTB v2 — passes $booking object)
// This is the preferred hook — the $booking object is fully populated.
// ============================================================

add_action( 'rtb_booking_post_save', function ( $booking ) {

    $booking_date = '';
    $booking_time = '';

    if ( ! empty( $booking->date ) ) {
        if ( $booking->date instanceof DateTime ) {
            $booking_date = $booking->date->format( 'Y-m-d' );
            $booking_time = $booking->date->format( 'H:i' );
        } else {
            $ts = strtotime( (string) $booking->date );
            if ( $ts ) {
                $booking_date = date( 'Y-m-d', $ts );
                $booking_time = date( 'H:i',   $ts );
            }
        }
    }

    // Fallback: read date from post meta in case $booking->date is empty
    if ( ! $booking_date || ! $booking_time ) {
        $meta_ts = get_post_meta( $booking->ID, 'rtb-date', true );
        if ( $meta_ts ) {
            $ts = is_numeric( $meta_ts ) ? (int) $meta_ts : strtotime( $meta_ts );
            if ( $ts ) {
                $booking_date = $booking_date ?: date( 'Y-m-d', $ts );
                $booking_time = $booking_time ?: date( 'H:i',   $ts );
            }
        }
    }

    sicantina_process_booking( $booking->ID, [
        'name'         => $booking->name   ?? get_post_meta( $booking->ID, 'rtb-name',    true ),
        'email'        => $booking->email  ?? get_post_meta( $booking->ID, 'rtb-email',   true ),
        'phone'        => ! empty( $booking->phone )
                            ? $booking->phone
                            : get_post_meta( $booking->ID, 'rtb-phone', true ),
        'party'        => ! empty( $booking->party )
                            ? $booking->party
                            : get_post_meta( $booking->ID, 'rtb-party', true ),
        'booking_date' => $booking_date,
        'booking_time' => $booking_time,
        'notes'        => $booking->request ?? get_post_meta( $booking->ID, 'rtb-message', true ),
    ], 'rtb_booking_post_save' );

}, 20 );

// ============================================================
// Hook 2: save_post_rtb-booking  (WordPress native — always fires)
// Fallback for RTB forks / older versions that don't fire hook 1.
// Reads all data from post meta, which RTB always populates.
// ============================================================

add_action( 'save_post_rtb-booking', function ( int $post_id, \WP_Post $post, bool $update ) {

    // Skip auto-saves, revisions, and trash transitions
    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) return;
    if ( wp_is_post_revision( $post_id ) )                return;
    if ( $post->post_status === 'trash' )                 return;

    // Read booking date/time from post meta
    $meta_ts = get_post_meta( $post_id, 'rtb-date', true );
    $booking_date = '';
    $booking_time = '';
    if ( $meta_ts ) {
        $ts = is_numeric( $meta_ts ) ? (int) $meta_ts : strtotime( (string) $meta_ts );
        if ( $ts ) {
            $booking_date = date( 'Y-m-d', $ts );
            $booking_time = date( 'H:i',   $ts );
        }
    }

    sicantina_process_booking( $post_id, [
        'name'         => get_post_meta( $post_id, 'rtb-name',    true ),
        'email'        => get_post_meta( $post_id, 'rtb-email',   true ),
        'phone'        => get_post_meta( $post_id, 'rtb-phone',   true ),
        'party'        => get_post_meta( $post_id, 'rtb-party',   true ),
        'booking_date' => $booking_date,
        'booking_time' => $booking_time,
        'notes'        => get_post_meta( $post_id, 'rtb-message', true ),
    ], 'save_post_rtb-booking' );

}, 99, 3 );

// ============================================================
// Show sync badge on the RTB booking edit screen
// ============================================================

add_action('add_meta_boxes', function () {
    add_meta_box(
        'sicantina_sync_status', 'Dashboard Sync',
        function ($post) {
            $synced = get_post_meta($post->ID, '_sicantina_synced', true);
            $res_id = get_post_meta($post->ID, '_sicantina_reservation_id', true);
            if ($synced) {
                echo '<p style="color:green;margin:0">&#10003; Synced to dashboard</p>';
                echo '<p style="color:#888;font-size:11px;margin:4px 0 0">ID: <code>' . esc_html($res_id) . '</code></p>';
            } else {
                echo '<p style="color:#999;margin:0">&#10007; Not yet synced</p>';
            }
        },
        'rtb-booking', 'side', 'low'
    );
});
